/**
 * HDR passthrough: did any of the page's own code run after the overlay page
 * loaded?
 *
 * Capture decides which frames share an overlay by fingerprint equality
 * (`overlayFingerprint.ts`), and the fingerprint reads only what page script
 * can read back: the DOM, the CSSOM, form and scroll state, GSAP's values.
 * Plenty of what paints is not readable that way (`:focus`, `:popover-open`,
 * custom highlights, the selection, a custom element's `:state()`), and any
 * page function that runs on a seek can change it: a setter on a runtime
 * seek-time global, a wrapped runtime function, an accessor on a GSAP tween
 * target, a custom element reacting to an attribute GSAP writes, a
 * MutationObserver, a builtin the page replaced that the renderer calls.
 * Each probe then fingerprints equal while the pixels differ, and no
 * screenshot is taken.
 *
 * So the passthrough does not let fingerprints stand in for pixels once page
 * code runs after load. V8's precise call counts
 * (`Profiler.startPreciseCoverage` with `callCount`), started once the page
 * is ready and read after capture, cover eligibility's probes and every
 * capture seek; any function that ran in a script that is neither the
 * renderer's nor GSAP's declines the passthrough (`seek_callback`). Which
 * script is whose comes from how V8 compiled it, never from its URL
 * (`scriptOrigins.ts`), and a page script that takes a renderer script's name
 * declines it too. The runtime and GSAP write only what the fingerprint
 * reads, which is how the passthrough gets its speed on the compositions it
 * is for.
 */

import { type CaptureSession, getCdpSession } from "@hyperframes/engine";
import {
  recordScriptOrigins,
  type ScriptOrigin,
  type ScriptOriginRecord,
} from "./scriptOrigins.js";

/** The part of one `Profiler.takePreciseCoverage` script entry this module reads. */
export interface ScriptCoverageLike {
  scriptId: string;
  url: string;
  functions: Array<{ functionName: string; ranges: Array<{ count: number }> }>;
}

/**
 * The page functions that ran in a precise call-count report, as a log
 * detail, or `null` when only the renderer and GSAP ran.
 */
export async function findPageCodeInCoverage(
  scripts: readonly ScriptCoverageLike[],
  originOf: (scriptId: string) => Promise<ScriptOrigin>,
): Promise<string | null> {
  let count = 0;
  let first: string | undefined;
  for (const script of scripts) {
    const ran = script.functions.filter((fn) => (fn.ranges[0]?.count ?? 0) > 0);
    if (ran.length === 0 || (await originOf(script.scriptId)) !== "page") continue;
    count += ran.length;
    first ??= `${ran[0]?.functionName || "an anonymous function"} in ${script.url || `script ${script.scriptId}`}`;
  }
  return first === undefined ? null : `${count} page function(s) ran after load, first ${first}`;
}

/** The overlay page's watch: armed before navigation, counting from `start()`. */
export interface PageCodeWatch {
  /** Starts counting calls; call once the page is ready. Never throws. */
  start(): Promise<void>;
  /** What page code ran since `start()`, or why that cannot be said; ends the watch. */
  stop(): Promise<string | null>;
  /** Ends the watch without reading it; never throws. */
  dispose(): Promise<void>;
}

/**
 * Arm the watch on a page that has not navigated yet: its scripts are
 * recorded as they are compiled (`recordScriptOrigins`), from the renderer's
 * own `rendererScripts` texts. Uses the page's cached engine CDP session and
 * never detaches it (see `findSeekHookListeners`). Starting precise coverage
 * resets V8's call counts, so only calls made after `start()` are reported.
 * Anything that cannot be read is reported too: unread is not empty.
 */
export async function armPageCodeWatch(
  page: CaptureSession["page"],
  rendererScripts: readonly string[],
): Promise<PageCodeWatch> {
  const origins: ScriptOriginRecord = await recordScriptOrigins(page, rendererScripts);
  let client: Awaited<ReturnType<typeof getCdpSession>> | undefined;
  let state: "armed" | "counting" | "stopped" = "armed";
  let startError: string | undefined;
  const end = async () => {
    if (state === "stopped") return;
    const wasCounting = state === "counting";
    state = "stopped";
    if (client && wasCounting) {
      await client.send("Profiler.stopPreciseCoverage").catch(() => undefined);
      await client.send("Profiler.disable").catch(() => undefined);
    }
    await origins.dispose();
  };
  return {
    async start() {
      if (state !== "armed") return;
      state = "counting";
      try {
        client = await getCdpSession(page);
        await client.send("Profiler.enable");
        await client.send("Profiler.startPreciseCoverage", { callCount: true, detailed: false });
        // Counts from before the start (page load, a record another caller left running) are dropped here.
        await client.send("Profiler.takePreciseCoverage");
      } catch (error) {
        startError = error instanceof Error ? error.message : String(error);
      }
    },
    async stop() {
      try {
        if (state === "armed") return "call counts never started";
        if (state === "stopped") return "call counts already read";
        if (startError !== undefined) return `call counts unavailable (${startError})`;
        const originsFailure = origins.failure();
        if (originsFailure !== undefined) return originsFailure;
        const { result } = await (client as NonNullable<typeof client>).send(
          "Profiler.takePreciseCoverage",
        );
        return (
          (await findPageCodeInCoverage(result, origins.originOf)) ??
          (await origins.findImpersonation())
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return `call counts unavailable (${detail})`;
      } finally {
        await end();
      }
    },
    dispose: end,
  };
}

const watches = new WeakMap<CaptureSession["page"], PageCodeWatch>();

/** Remembers the watch armed on an overlay page. */
export function attachPageCodeWatch(page: CaptureSession["page"], watch: PageCodeWatch): void {
  watches.set(page, watch);
}

/** The watch armed on an overlay page, if any. */
export function pageCodeWatchOf(page: CaptureSession["page"]): PageCodeWatch | undefined {
  return watches.get(page);
}
