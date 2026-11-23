/**
 * HDR passthrough: which scripts on the overlay page are the renderer's.
 *
 * The page code watch (`pageCodeWatch.ts`) declines the passthrough when any
 * of the page's functions run on seeks, so it must tell the renderer's
 * functions from the page's without taking the page's word for it. A script
 * URL is the page's word: `//# sourceURL=` names a script anything, and
 * eval, `new Function` and inserted inline scripts all report an empty URL.
 *
 * So the overlay page's scripts are recorded as V8 parses them, from before
 * the page navigates (`Debugger.scriptParsed`), and a script is the
 * renderer's only when how it was made says so:
 *
 * - its exact text is one the renderer put in the page: the file server's
 *   injected scripts and the compiler's seek reapply (by SHA-256 of the text
 *   V8 compiled);
 * - it was compiled in an isolated world (DevTools utility worlds), which
 *   page script cannot reach;
 * - it was compiled in the main frame with no script on the stack and no
 *   embedding document, either before anything else in its document (the
 *   renderer's `evaluateOnNewDocument` scripts) or under a `pptr:` URL (a
 *   DevTools evaluation). Page code compiles this way only through a string
 *   timer, which the shim's callback record declines (`stringTimers`), or a
 *   `javascript:` URL.
 *
 * GSAP is told apart the same way: by the SHA-256 of a published build
 * (`gsapBuilds.ts`), served as is or inlined by the compiler, never by its
 * file name. Everything else, including any script never seen being parsed,
 * is the page's.
 */

import { createHash } from "node:crypto";
import { type CaptureSession, getCdpSession } from "@hyperframes/engine";
import { GSAP_BUILD_HASHES } from "./gsapBuilds.js";

export type ScriptOrigin = "renderer" | "gsap" | "page";

/**
 * Names only the renderer's scripts may take. The shim's callback record
 * trusts a registration from a script so named (`RENDERER_SCRIPTS` in
 * `fileServer.ts`); a page script taking one declines the passthrough.
 */
const RENDERER_SCRIPT_NAMES: readonly string[] = [
  "hyperframes://injected/",
  "hyperframes://position-seek-reapply",
  "pptr:",
];

/** The fields of a `Debugger.scriptParsed` event this module reads. */
export interface ParsedScriptEvent {
  scriptId: string;
  url: string;
  embedderName?: string;
  executionContextId: number;
  executionContextAuxData?: { isDefault?: boolean; type?: string; frameId?: string };
  stackTrace?: { callFrames?: unknown[] };
}

/** What a script's parse event alone says: the renderer's, or decided by its text. */
export type ParseVerdict = "renderer" | "by_text";

/** Compiled in a DevTools isolated world, which page script cannot reach. */
const inIsolatedWorld = (event: ParsedScriptEvent) =>
  event.executionContextAuxData?.type === "isolated";

/** Compiled in the main frame's own world. */
const inMainWorld = (event: ParsedScriptEvent, mainFrameId: string) =>
  event.executionContextAuxData?.type === "default" &&
  event.executionContextAuxData.frameId === mainFrameId;

/** Compiled with no script on the stack and no embedding document. */
const compiledFromOutside = (event: ParsedScriptEvent) =>
  !event.embedderName && (event.stackTrace?.callFrames?.length ?? 0) === 0;

/**
 * Classifies parse events in the order V8 emits them. `mainFrameId` is the
 * overlay page's top frame.
 */
export function createParseClassifier(
  mainFrameId: string,
): (event: ParsedScriptEvent) => ParseVerdict {
  // Execution contexts in which only scripts compiled from outside have been compiled so far.
  const openingRun = new Map<number, boolean>();
  return (event) => {
    if (inIsolatedWorld(event)) return "renderer";
    const outside = compiledFromOutside(event);
    const opening = openingRun.get(event.executionContextId) ?? true;
    openingRun.set(event.executionContextId, opening && outside);
    if (!outside || !inMainWorld(event, mainFrameId)) return "by_text";
    return opening || event.url.startsWith("pptr:") ? "renderer" : "by_text";
  };
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

/** A script's origin from its parse verdict and, when that does not decide it, its text. */
export function originFromText(
  verdict: ParseVerdict,
  text: string | undefined,
  rendererHashes: ReadonlySet<string>,
): ScriptOrigin {
  if (verdict === "renderer") return "renderer";
  if (text === undefined) return "page";
  if (rendererHashes.has(sha256(text))) return "renderer";
  return isGsapBuild(text) ? "gsap" : "page";
}

/** A running record of the overlay page's scripts. */
export interface ScriptOriginRecord {
  /** The origin of a script by its V8 id; a script never seen being parsed is the page's. */
  originOf(scriptId: string): Promise<ScriptOrigin>;
  /** A page script that took one of `RENDERER_SCRIPT_NAMES`, as a log detail, or null. */
  findImpersonation(): Promise<string | null>;
  /** Why the record cannot be trusted, if it cannot. */
  failure(): string | undefined;
  /** Stops recording; never throws. */
  dispose(): Promise<void>;
}

interface Parsed {
  url: string;
  verdict: ParseVerdict;
}

type CdpClient = Awaited<ReturnType<typeof getCdpSession>>;

/**
 * Start recording the scripts of a page that has not navigated yet. Uses the
 * page's cached engine CDP session. A record that could not start says so
 * through `failure()`, and the watch falls back on it.
 */
export async function recordScriptOrigins(
  page: CaptureSession["page"],
  rendererScripts: readonly string[],
): Promise<ScriptOriginRecord> {
  const rendererHashes = new Set(rendererScripts.map(sha256));
  const parsed = new Map<string, Parsed>();
  const texts = new Map<string, Promise<string | undefined>>();
  let failure: string | undefined;
  let classify: ((event: ParsedScriptEvent) => ParseVerdict) | undefined;
  let client: CdpClient | undefined;
  const onParsed = (event: ParsedScriptEvent) => {
    if (!classify) return;
    // A later script with the same id (a renderer process swap) replaces the dead one.
    parsed.set(event.scriptId, { url: event.url, verdict: classify(event) });
    texts.delete(event.scriptId);
  };
  try {
    client = await getCdpSession(page);
    const { frameTree } = (await client.send("Page.getFrameTree")) as {
      frameTree: { frame: { id: string } };
    };
    classify = createParseClassifier(frameTree.frame.id);
    client.on("Debugger.scriptParsed", onParsed);
    await client.send("Debugger.enable");
    // A `debugger` statement must not stop the page on this session's account.
    await client.send("Debugger.setSkipAllPauses", { skip: true });
  } catch (error) {
    failure = `script record unavailable (${error instanceof Error ? error.message : String(error)})`;
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
  const originOf = async (scriptId: string): Promise<ScriptOrigin> => {
    const entry = parsed.get(scriptId);
    if (!entry) return "page";
    if (entry.verdict === "renderer") return "renderer";
    return originFromText(entry.verdict, await textOf(scriptId), rendererHashes);
  };

  return {
    originOf,
    async findImpersonation() {
      for (const [scriptId, { url }] of parsed) {
        if (!RENDERER_SCRIPT_NAMES.some((name) => url.startsWith(name))) continue;
        if ((await originOf(scriptId)) !== "renderer") return `a page script is named ${url}`;
      }
      return null;
    },
    failure: () => failure,
    async dispose() {
      if (!client) return;
      client.off("Debugger.scriptParsed", onParsed);
      await client.send("Debugger.disable").catch(() => undefined);
      classify = undefined;
    },
  };
}
