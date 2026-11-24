/**
 * HDR passthrough: which scripts on the overlay page are the renderer's.
 *
 * The page code watch (`pageCodeWatch.ts`) declines the passthrough when any
 * of the page's functions run on seeks, so it must tell the renderer's
 * functions from the page's without taking the page's word for it. Nothing
 * about how a script looks from outside is the renderer's word: a URL is
 * whatever `//# sourceURL=` says, and a `javascript:` URL or a string timer
 * compiles with no script on the stack and no embedding document, exactly as
 * a DevTools evaluation does.
 *
 * So a script is the renderer's only by identity:
 *
 * - its exact text (SHA-256 of what V8 compiled) is one the renderer put in
 *   the page: the file server's injected scripts, the compiler's seek
 *   reapply, and every script the renderer sends the page over DevTools
 *   (`Page.addScriptToEvaluateOnNewDocument`, `Runtime.evaluate`,
 *   `Runtime.callFunctionOn`, `Debugger.evaluateOnCallFrame`), recorded as
 *   each is sent on every DevTools session the overlay page has
 *   (`interceptRendererTexts`), from before the engine sets the page up;
 * - or it was compiled in an isolated world (DevTools utility worlds), which
 *   page script cannot reach.
 *
 * GSAP is told apart the same way, by the SHA-256 of a published build
 * (`gsapBuilds.ts`), served as is or inlined by the compiler. Everything
 * else, including any script never seen being parsed, is the page's.
 *
 * Two kinds of compile decline the passthrough outright, whether or not the
 * script runs again (`findUntrustedCompiles`): a script compiled in the main
 * world with no script on the stack and no embedding document whose text the
 * renderer did not send (a `javascript:` URL, a string timer), and any
 * script compiled in another frame's main world (another realm, whose
 * builtins and observers none of the passthrough's checks reach).
 *
 * When the record starts (`ScriptRecordStart`): the analysis page's starts
 * as the page opens, so every compile is seen as it happens. The capture
 * page's starts only once the page is ready (`observe()`): with the
 * debugger enabled, V8 reports every compile to DevTools, which makes
 * compiling many times slower, and a page that times its own compiles while
 * it loads would tell the capture page from the layered session (which has
 * no debugger) and paint differently there. Enabling the debugger replays
 * every live script, with its realm but without the stack it was compiled
 * from (`unobserved`): whose it is still comes from its text alone, so it
 * is the renderer's or GSAP's only by identity and the page's otherwise,
 * and any of its functions that runs after the page is ready is counted
 * and declines. That it was compiled with nothing on the stack (a string
 * timer while the page loaded) cannot be told, and is not needed: such a
 * compile ran while the capture page loaded as the layered session's
 * page does, and a dynamically inserted `<script>` has no embedding
 * document either, so declining every replayed script without one would
 * decline pages that build their scripts at load. A script no longer alive
 * by then cannot run again; one never seen at all is the page's.
 */

import { createHash } from "node:crypto";
import { type CaptureSession, getCdpSession } from "@hyperframes/engine";
import { GSAP_BUILD_HASHES } from "./gsapBuilds.js";

export type ScriptOrigin = "renderer" | "gsap" | "page";

/** The fields of a `Debugger.scriptParsed` event this module reads. */
export interface ParsedScriptEvent {
  scriptId: string;
  url: string;
  embedderName?: string;
  executionContextId: number;
  executionContextAuxData?: { isDefault?: boolean; type?: string; frameId?: string };
  stackTrace?: { callFrames?: unknown[] };
}

/**
 * Where a script was compiled, as far as trust goes: an isolated world
 * (the renderer's), the main frame's main world from outside (no script on
 * the stack, no embedding document: its text must be one the renderer
 * sent), the main frame's main world from page activity, the main frame's
 * main world before the record started (replayed: how is unknown), or
 * another realm.
 */
export type CompileKind = "isolated" | "outside" | "page" | "unobserved" | "other_realm";

/**
 * How the overlay page's main frame compiled a script. `observed` is false
 * for a script the debugger replayed when it was enabled after the compile:
 * the event's stack is then the replay's, not the compile's.
 */
export function compileKind(
  event: ParsedScriptEvent,
  mainFrameId: string,
  observed = true,
): CompileKind {
  const aux = event.executionContextAuxData;
  if (aux?.type === "isolated") return "isolated";
  if (aux?.type !== "default" || aux.frameId !== mainFrameId) return "other_realm";
  if (!observed) return "unobserved";
  const outside = !event.embedderName && (event.stackTrace?.callFrames?.length ?? 0) === 0;
  return outside ? "outside" : "page";
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const KNOWN_GSAP = new Set(
  Object.values(GSAP_BUILD_HASHES).flatMap((files) => Object.values(files)),
);

/** The compiler's wrapper around an inlined script (`inlineExternalScripts` in `htmlCompiler.ts`). */
const INLINED_SCRIPT = /^\/\* inlined: [^\n]* \*\/\n([\s\S]*)\n\/\/# sourceURL=[^\n]*\n$/;

/** Whether `text` is a published GSAP build, as served or as the compiler inlines it. */
export function isGsapBuild(text: string): boolean {
  if (KNOWN_GSAP.has(sha256(text))) return true;
  const inlined = INLINED_SCRIPT.exec(text);
  return inlined !== null && KNOWN_GSAP.has(sha256(inlined[1] ?? ""));
}

/** A script's origin from how it was compiled and, outside an isolated world, its text. */
export function originFromText(
  kind: CompileKind,
  text: string | undefined,
  rendererHashes: ReadonlySet<string>,
): ScriptOrigin {
  if (kind === "isolated") return "renderer";
  if (text === undefined) return "page";
  if (rendererHashes.has(sha256(text))) return "renderer";
  return isGsapBuild(text) ? "gsap" : "page";
}

/** The fields of the DevTools commands whose text V8 compiles into the page. */
type SentParams = Record<string, unknown> | undefined;

/**
 * The script text V8 compiles for a DevTools command, or `undefined` for one
 * that compiles none. `Runtime.callFunctionOn` compiles its declaration in
 * parentheses.
 */
export function compiledTextOf(method: string, params: SentParams): string | undefined {
  const field = (name: string) => {
    const value = params?.[name];
    return typeof value === "string" ? value : undefined;
  };
  switch (method) {
    case "Page.addScriptToEvaluateOnNewDocument":
      return field("source");
    case "Runtime.evaluate":
    case "Runtime.compileScript":
    case "Debugger.evaluateOnCallFrame":
      return field("expression");
    case "Runtime.callFunctionOn": {
      const declaration = field("functionDeclaration");
      return declaration === undefined ? undefined : `(${declaration})`;
    }
    default:
      return undefined;
  }
}

type CdpClient = Awaited<ReturnType<typeof getCdpSession>>;
type Send = CdpClient["send"];

const intercepted = new WeakSet<object>();

/** Records the text of every script `session` sends, before it is sent. */
function interceptSession(session: object, note: (text: string) => void): void {
  if (intercepted.has(session)) return;
  const target = session as { send: Send };
  const send = target.send;
  if (typeof send !== "function") return;
  intercepted.add(session);
  const wrapped = function (
    this: unknown,
    method: string,
    params?: SentParams,
    ...rest: unknown[]
  ) {
    const text = compiledTextOf(method, params);
    if (text !== undefined) note(text);
    return (send as (...args: unknown[]) => unknown).call(this, method, params, ...rest);
  };
  target.send = wrapped as unknown as Send;
}

/**
 * Records every script text the renderer sends `page` over DevTools: on the
 * page's own session, the engine's cached session, and every session the
 * page creates from now on. Call before the engine registers or evaluates
 * anything on the page. Only this overlay page is touched.
 */
async function interceptRendererTexts(
  page: CaptureSession["page"],
  note: (text: string) => void,
): Promise<void> {
  const frame = page.mainFrame() as unknown as { client?: object };
  if (frame.client) interceptSession(frame.client, note);
  const internal = (page as unknown as { _client?: () => object })._client;
  if (typeof internal === "function") interceptSession(internal.call(page), note);
  const create = page.createCDPSession.bind(page);
  (page as { createCDPSession: typeof create }).createCDPSession = async () => {
    const session = await create();
    interceptSession(session, note);
    return session;
  };
  interceptSession(await getCdpSession(page), note);
}

/** A running record of the overlay page's scripts. */
export interface ScriptOriginRecord {
  /** The origin of a script by its V8 id; a script never seen being parsed is the page's. */
  originOf(scriptId: string): Promise<ScriptOrigin>;
  /** The SHA-256 of a parsed script's text, which names it across pages; undefined when unreadable. */
  hashOf(scriptId: string): Promise<string | undefined>;
  /** How a parsed script was compiled, or undefined for one never seen. */
  kindOf(scriptId: string): CompileKind | undefined;
  /** The execution context a parsed script was compiled in. */
  contextOf(scriptId: string): number | undefined;
  /**
   * A compile that declines the passthrough by itself (see the module
   * comment), as a log detail, or null.
   */
  findUntrustedCompiles(): Promise<string | null>;
  /** The overlay page's top frame. */
  readonly mainFrameId: string | undefined;
  /**
   * Starts a record armed with `"ready"`: enables the debugger, which replays
   * every live script (their compiles were not seen). Call once the page is
   * ready, before anything reads the record; a no-op for a record started
   * as the page opened. Never throws: a failure shows in `failure()`.
   */
  observe(): Promise<void>;
  /** Why the record cannot be trusted, if it cannot. */
  failure(): string | undefined;
  /** Stops recording; never throws. */
  dispose(): Promise<void>;
}

interface Parsed {
  url: string;
  kind: CompileKind;
  context: number;
}

/**
 * When a record sees compiles: `"open"`, from before the page navigates
 * (the debugger is on while it loads); `"ready"`, from `observe()` on, the
 * page loading with no debugger at all (see the module comment).
 */
export type ScriptRecordStart = "open" | "ready";

/**
 * Start recording the scripts of a page that has not navigated yet, and
 * the renderer's own texts as it sends them (`interceptRendererTexts`),
 * which are recorded from now on either way. Uses the page's cached engine
 * CDP session. A record that could not start, or was armed with `"ready"`
 * and never observed, says so through `failure()`, and the watch falls
 * back on it.
 */
export async function recordScriptOrigins(
  page: CaptureSession["page"],
  rendererScripts: readonly string[],
  start: ScriptRecordStart = "open",
): Promise<ScriptOriginRecord> {
  const rendererHashes = new Set(rendererScripts.map(sha256));
  const parsed = new Map<string, Parsed>();
  const texts = new Map<string, Promise<string | undefined>>();
  // Decided origins: a renderer or GSAP script stays one. A page script is decided again, since
  // the renderer can send its exact text later (the same expression evaluated twice).
  const decided = new Map<string, ScriptOrigin>();
  const hashes = new Map<string, string | undefined>();
  let failure: string | undefined;
  let mainFrameId: string | undefined;
  let client: CdpClient | undefined;
  let recording = true;
  // A record started once the page is ready ignores what anything else's debugger session saw
  // while the page loaded (the engine enables it briefly to name a throw site).
  let listening = start === "open";
  // Scripts parsed while `Debugger.enable` runs are replays: their compile happened before.
  let replaying = false;
  const onParsed = (event: ParsedScriptEvent) => {
    if (!recording || !listening || mainFrameId === undefined) return;
    // A later script with the same id (a renderer process swap) replaces the dead one.
    decided.delete(event.scriptId);
    hashes.delete(event.scriptId);
    parsed.set(event.scriptId, {
      url: event.url,
      kind: compileKind(event, mainFrameId, !replaying),
      context: event.executionContextId,
    });
    texts.delete(event.scriptId);
  };
  const unavailable = (error: unknown) =>
    `script record unavailable (${error instanceof Error ? error.message : String(error)})`;
  try {
    await interceptRendererTexts(page, (text) => rendererHashes.add(sha256(text)));
    client = await getCdpSession(page);
    const { frameTree } = (await client.send("Page.getFrameTree")) as {
      frameTree: { frame: { id: string } };
    };
    mainFrameId = frameTree.frame.id;
    client.on("Debugger.scriptParsed", onParsed);
    // Before navigation the page's scripts are all still to come: every one is seen compiling.
    if (start === "open") await client.send("Debugger.enable");
  } catch (error) {
    failure = unavailable(error);
  }

  const textOf = (scriptId: string): Promise<string | undefined> => {
    let text = texts.get(scriptId);
    if (!text) {
      text = client
        ? client
            .send("Debugger.getScriptSource", { scriptId })
            .then(({ scriptSource }) => scriptSource)
            .catch(() => undefined)
        : Promise.resolve(undefined);
      texts.set(scriptId, text);
    }
    return text;
  };
  const hashOf = async (scriptId: string): Promise<string | undefined> => {
    if (!parsed.has(scriptId)) return undefined;
    if (!hashes.has(scriptId)) {
      const text = await textOf(scriptId);
      hashes.set(scriptId, text === undefined ? undefined : sha256(text));
      if (text !== undefined && isGsapBuild(text)) decided.set(scriptId, "gsap");
    }
    return hashes.get(scriptId);
  };
  // fallow-ignore-next-line complexity
  const originOf = async (scriptId: string): Promise<ScriptOrigin> => {
    const entry = parsed.get(scriptId);
    if (!entry) return "page";
    if (entry.kind === "isolated") return "renderer";
    const known = decided.get(scriptId);
    if (known) return known;
    await hashOf(scriptId);
    const gsap = decided.get(scriptId);
    if (gsap) return gsap;
    const hash = hashes.get(scriptId);
    if (hash !== undefined && rendererHashes.has(hash)) {
      decided.set(scriptId, "renderer");
      return "renderer";
    }
    return "page";
  };

  return {
    originOf,
    hashOf,
    kindOf: (scriptId) => parsed.get(scriptId)?.kind,
    contextOf: (scriptId) => parsed.get(scriptId)?.context,
    get mainFrameId() {
      return mainFrameId;
    },
    async findUntrustedCompiles() {
      for (const [scriptId, { url, kind }] of parsed) {
        if (kind === "other_realm")
          return `a script compiled in another realm (${url || "no url"})`;
        if (kind !== "outside" || (await originOf(scriptId)) === "renderer") continue;
        const where = url ? ` (${url})` : "";
        return `a script compiled with no script on the stack that the renderer did not send${where}: a javascript: URL or a string timer`;
      }
      return null;
    },
    async observe() {
      if (listening || failure !== undefined || !client) return;
      listening = true;
      replaying = true;
      try {
        await client.send("Debugger.enable");
      } catch (error) {
        failure = unavailable(error);
      } finally {
        replaying = false;
      }
    },
    failure: () => failure ?? (listening ? undefined : "script record never started"),
    async dispose() {
      if (!client || !recording) return;
      recording = false;
      client.off("Debugger.scriptParsed", onParsed);
    },
  };
}
