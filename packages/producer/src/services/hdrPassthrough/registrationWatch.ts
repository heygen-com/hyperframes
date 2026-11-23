/**
 * HDR passthrough: callbacks and own-clock content the page registers, seen
 * from outside the page.
 *
 * Capture reads frames out of order and more than once, so the passthrough
 * declines page code that keeps state across seeks or runs where V8's call
 * counts cannot see it: an animation-frame callback the page registers, a
 * string or builtin timer callback, an observer, a custom element
 * definition, a worker, an offscreen canvas, a worklet. None of those can be
 * read back once registered (nothing reads an observer's callback or the
 * registry's lifecycle callbacks), and wrapping the constructors in the page
 * would change what page code sees (`String(MutationObserver)`, an error's
 * stack, `Error.prototype.name` getters run while formatting one), so a
 * fallback would not render as the flag-off path does.
 *
 * So nothing is installed in the page. Through DevTools, with the
 * debugger:
 *
 * - every script's first statement pauses until the page's own scripts
 *   start; at the first one in a document, before any page script has run,
 *   the main world's builtins are captured (`CAPTURE_SOURCE`, see
 *   `mainWorld.ts`) and a function-call breakpoint is set on each
 *   registration builtin, the captured originals, which page script cannot
 *   reach before they are taken;
 * - at the first statement of the first script that is not the renderer's
 *   (the virtual-time shim has run by then), breakpoints go on the shim's
 *   `requestAnimationFrame`, `setTimeout` and `setInterval` too;
 * - every breakpoint goes when the page reports ready (`ready()`): after
 *   that a registration needs page code to run, which the page code watch
 *   counts, or a builtin to run from a route the gates already decline;
 * - each breakpoint names its caller from the paused stack, which page code
 *   cannot shape: the caller's script is the renderer's only by its exact
 *   text (`scriptOrigins.ts`). A registration from anything else declines
 *   the passthrough (`findings()`), as does one with no script on the stack
 *   (a builtin calling it). A page timer passes when its callback is page
 *   script (it runs on the wall clock while the page loads, and the page
 *   code watch counts it if it runs later); a string or builtin callback
 *   declines.
 *
 * A page `debugger` statement pauses too and is resumed at once. Pausing
 * changes no page-visible state, only when the page's scripts get to run.
 */

import type { getCdpSession } from "@hyperframes/engine";
import { CAPTURE_OBJECT_GROUP, CAPTURE_SOURCE } from "./mainWorld.js";
import {
  nonScriptCallable,
  type PropertiesLike,
  type RemoteObjectLike,
} from "./nativeCallbacks.js";
import type { ScriptOriginRecord } from "./scriptOrigins.js";

type Client = Awaited<ReturnType<typeof getCdpSession>>;

/** The capture's `refs` whose calls register something that runs or paints on its own. */
const REGISTRATIONS: ReadonlyArray<[ref: string, what: string]> = [
  ["MutationObserver", "a MutationObserver"],
  ["ResizeObserver", "a ResizeObserver"],
  ["IntersectionObserver", "an IntersectionObserver"],
  ["PerformanceObserver", "a PerformanceObserver"],
  ["ReportingObserver", "a ReportingObserver"],
  ["define", "a custom element definition"],
  ["Worker", "a Worker"],
  ["SharedWorker", "a SharedWorker"],
  ["registerServiceWorker", "a service worker"],
  ["addWorkletModule", "a worklet module"],
  ["transferControlToOffscreen", "an offscreen canvas"],
  ["OffscreenCanvas", "an OffscreenCanvas"],
  ["startViewTransition", "a view transition"],
  ["open", "a window.open"],
];

/** The shim's wrappers whose page registrations are callbacks that run on seeks. */
const SHIM_WRAPPERS: ReadonlyArray<[global: string, what: string]> = [
  ["requestAnimationFrame", "a requestAnimationFrame callback"],
  ["setTimeout", "a timer"],
  ["setInterval", "a timer"],
];

/** The fields of a `Debugger.paused` event this module reads. */
interface PausedEventLike {
  reason: string;
  data?: { eventName?: string };
  hitBreakpoints?: string[];
  callFrames: Array<{
    callFrameId: string;
    functionName?: string;
    url?: string;
    location: { scriptId: string; lineNumber?: number };
  }>;
}

export interface RegistrationWatch {
  /** The page reported ready: stops watching the shim's timers and animation frames. */
  ready(): Promise<void>;
  /** What the page registered that declines the passthrough, as a log detail, or null. */
  findings(): string | null;
  /** How often the watch paused the page, and for how long in all. */
  stats(): { pauses: number; pausedMs: number };
  /** The capture of the current document's builtins (`CAPTURE_SOURCE`), once taken. */
  captureId(): string | undefined;
  /** Why the watch cannot be trusted, if it cannot. */
  failure(): string | undefined;
  /** Removes the breakpoints and stops listening; never throws. */
  dispose(): Promise<void>;
}

type Breakpoint = { kind: "native"; what: string } | { kind: "shim"; what: string; timer: boolean };

/**
 * Arm the watch on a page that has not navigated yet. `origins` must be
 * recording already (`recordScriptOrigins`), on the same `client`.
 */
export async function armRegistrationWatch(
  client: Client,
  origins: ScriptOriginRecord,
): Promise<RegistrationWatch> {
  const breakpoints = new Map<string, Breakpoint>();
  const found: string[] = [];
  let failure: string | undefined;
  let watchingLoad = true;
  let disposed = false;
  // The document being watched: its execution context, capture and whether its page scripts started.
  let documentContext: number | undefined;
  let capture: string | undefined;
  let pageScriptsStarted = false;
  let documentsWithPageScripts = 0;

  const fail = (detail: string) => {
    failure ??= detail;
  };
  const note = (detail: string) => {
    if (found.length < 64) found.push(detail);
  };

  const evaluateOnFrame = async (callFrameId: string, expression: string) => {
    const { result, exceptionDetails } = (await client.send("Debugger.evaluateOnCallFrame", {
      callFrameId,
      expression,
      objectGroup: CAPTURE_OBJECT_GROUP,
    })) as { result: RemoteObjectLike; exceptionDetails?: { text?: string } };
    if (exceptionDetails) throw new Error(exceptionDetails.text || "evaluation failed");
    return result;
  };
  const props = async (objectId: string) =>
    (await client.send("Runtime.getProperties", {
      objectId,
      ownProperties: true,
    })) as PropertiesLike;
  const valueOf = async (objectId: string, name: string) =>
    (await props(objectId)).result.find((entry) => entry.name === name)?.value;

  const setBreakpoint = async (target: RemoteObjectLike, breakpoint: Breakpoint) => {
    if (!target.objectId || target.type !== "function") return;
    const { breakpointId } = (await client.send("Debugger.setBreakpointOnFunctionCall", {
      objectId: target.objectId,
    })) as { breakpointId: string };
    breakpoints.set(breakpointId, breakpoint);
  };

  /** First statement of the document's first script: no page script has run in it yet. */
  const startDocument = async (callFrameId: string, contextId: number) => {
    documentContext = contextId;
    pageScriptsStarted = false;
    const captured = await evaluateOnFrame(callFrameId, CAPTURE_SOURCE);
    if (!captured.objectId) throw new Error("builtin capture returned no object");
    capture = captured.objectId;
    const refs = await valueOf(capture, "refs");
    if (!refs?.objectId) throw new Error("builtin capture has no refs");
    for (const [ref, what] of REGISTRATIONS) {
      const target = await valueOf(refs.objectId, ref);
      if (target && target.type === "function")
        await setBreakpoint(target, { kind: "native", what });
    }
  };

  /** First statement of the first script that is not the renderer's: the shim has run. */
  // fallow-ignore-next-line complexity
  const startPageScripts = async (callFrameId: string) => {
    pageScriptsStarted = true;
    documentsWithPageScripts++;
    if (documentsWithPageScripts > 1) note("the page loaded another document");
    for (const [name, what] of SHIM_WRAPPERS) {
      const wrapper = await evaluateOnFrame(callFrameId, `window.${name}`);
      const location = wrapper.objectId
        ? (await props(wrapper.objectId)).internalProperties?.find(
            (entry) => entry.name === "[[FunctionLocation]]",
          )?.value
        : undefined;
      const scriptId = (location?.value as { scriptId?: string } | undefined)?.scriptId;
      if (!scriptId || (await origins.originOf(scriptId)) !== "renderer") {
        throw new Error(`${name} is not the virtual-time shim's`);
      }
      await setBreakpoint(wrapper, { kind: "shim", what, timer: name !== "requestAnimationFrame" });
    }
  };

  const callerOrigin = async (frame: PausedEventLike["callFrames"][number] | undefined) =>
    frame ? origins.originOf(frame.location.scriptId) : undefined;

  // fallow-ignore-next-line complexity
  const onRegistration = async (event: PausedEventLike, breakpoint: Breakpoint) => {
    // A builtin pauses before it runs, with its caller on top; a shim wrapper pauses inside itself.
    const caller = breakpoint.kind === "native" ? event.callFrames[0] : event.callFrames[1];
    const origin = await callerOrigin(caller);
    if (origin === "renderer" || (breakpoint.kind === "shim" && origin === "gsap")) return;
    const by = origin === undefined ? "with no script on the stack" : `from ${origin} script`;
    if (breakpoint.kind === "shim" && breakpoint.timer && origin === "page") {
      const wrapper = event.callFrames[0];
      if (!wrapper) return note(`${breakpoint.what} ${by}`);
      const callback = await evaluateOnFrame(wrapper.callFrameId, "callback");
      if (callback.type === "function" || callback.subtype === "proxy") {
        const native = await nonScriptCallable(callback, props);
        if (native) note(`${breakpoint.what} whose callback is ${native}`);
        return;
      }
      return note(`a string timer ${by}`);
    }
    note(`${breakpoint.what} ${by}`);
  };

  const onFirstStatement = async (event: PausedEventLike) => {
    const top = event.callFrames[0];
    if (!top) return;
    const scriptId = top.location.scriptId;
    const kind = origins.kindOf(scriptId);
    const contextId = origins.contextOf(scriptId);
    if ((kind !== "outside" && kind !== "page") || contextId === undefined) return;
    if (contextId !== documentContext) await startDocument(top.callFrameId, contextId);
    if (!pageScriptsStarted && (await origins.originOf(scriptId)) !== "renderer") {
      await startPageScripts(top.callFrameId);
    }
  };

  let pauses = 0;
  let pausedMs = 0;
  // fallow-ignore-next-line complexity
  const onPaused = async (event: PausedEventLike) => {
    const started = Date.now();
    pauses++;
    try {
      if (disposed) return;
      if (
        event.reason === "EventListener" &&
        event.data?.eventName === "instrumentation:scriptFirstStatement"
      ) {
        if (watchingLoad) await onFirstStatement(event);
        return;
      }
      for (const id of event.hitBreakpoints ?? []) {
        const breakpoint = breakpoints.get(id);
        if (breakpoint) await onRegistration(event, breakpoint);
      }
    } catch (error) {
      fail(`registration watch failed (${error instanceof Error ? error.message : String(error)})`);
    } finally {
      await client.send("Debugger.resume").catch(() => undefined);
      pausedMs += Date.now() - started;
    }
  };
  const listener = (event: PausedEventLike) => {
    void onPaused(event);
  };

  try {
    client.on("Debugger.paused", listener);
    await client.send("Debugger.setSkipAllPauses", { skip: false });
    await client.send("DOMDebugger.setInstrumentationBreakpoint", {
      eventName: "scriptFirstStatement",
    });
  } catch (error) {
    fail(
      `registration watch unavailable (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  return {
    async ready() {
      if (!watchingLoad) return;
      watchingLoad = false;
      await client
        .send("DOMDebugger.removeInstrumentationBreakpoint", { eventName: "scriptFirstStatement" })
        .catch(() => undefined);
      // Every breakpoint goes: after the page is ready a registration needs page code to run (which
      // the page code watch counts) or a builtin to run from a route this watch or the other gates
      // already declined, and a breakpoint left set slows every seek the probes make.
      for (const id of breakpoints.keys()) {
        await client.send("Debugger.removeBreakpoint", { breakpointId: id }).catch(() => undefined);
      }
      breakpoints.clear();
      await client.send("Debugger.setSkipAllPauses", { skip: true }).catch(() => undefined);
      if (capture === undefined) fail("the document's builtins were never captured");
    },
    findings() {
      if (found.length === 0) return null;
      return `${found.length} registration(s) by the page, first ${found[0]}`;
    },
    captureId: () => capture,
    stats: () => ({ pauses, pausedMs }),
    failure: () => failure,
    async dispose() {
      if (disposed) return;
      disposed = true;
      client.off("Debugger.paused", listener);
      await client
        .send("DOMDebugger.removeInstrumentationBreakpoint", { eventName: "scriptFirstStatement" })
        .catch(() => undefined);
      for (const id of breakpoints.keys()) {
        await client.send("Debugger.removeBreakpoint", { breakpointId: id }).catch(() => undefined);
      }
      breakpoints.clear();
      await client
        .send("Runtime.releaseObjectGroup", { objectGroup: CAPTURE_OBJECT_GROUP })
        .catch(() => undefined);
    },
  };
}
