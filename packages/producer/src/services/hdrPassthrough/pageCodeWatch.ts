/**
 * HDR passthrough: did any of the page's own code run while overlay capture
 * seeked?
 *
 * Capture decides which frames share an overlay by fingerprint equality
 * (`overlayFingerprint.ts`), and the fingerprint reads only what page script
 * can read back: the DOM, the CSSOM, form and scroll state, GSAP's values.
 * Plenty of what paints is not readable that way (`:focus`, `:popover-open`,
 * custom highlights, the selection, a custom element's `:state()`), and any
 * page function that runs on a seek can change it: a setter on a runtime
 * seek-time global, a wrapped runtime function, an accessor on a GSAP tween
 * target, a custom element reacting to an attribute GSAP writes, a
 * MutationObserver. Each probe then fingerprints equal while the pixels
 * differ, and no screenshot is taken.
 *
 * So the passthrough does not let fingerprints stand in for pixels while page
 * code runs on seeks. V8's precise call counts (`Profiler.startPreciseCoverage`
 * with `callCount`) record every function that ran during capture; any that
 * belongs to neither the renderer (`hyperframes://` scripts, DevTools
 * evaluations) nor GSAP declines the passthrough (`seek_callback`). The
 * runtime and GSAP write only what the fingerprint reads, which is how the
 * passthrough gets its speed on the compositions it is for.
 */

import { type CaptureSession, getCdpSession } from "@hyperframes/engine";

/** The part of one `Profiler.takePreciseCoverage` script entry this module reads. */
export interface ScriptCoverageLike {
  url: string;
  functions: Array<{ functionName: string; ranges: Array<{ count: number }> }>;
}

/**
 * Scripts whose functions run on seeks without being the page's: the
 * renderer's own (`hyperframes://`, which the compiler and file server tag
 * their scripts with; `pptr:` and the empty URL, DevTools evaluations and
 * scripts added before navigation). The composition's own inline code is
 * `hyperframes-composition://`, which this leaves out.
 */
const RENDERER_SCRIPT_URL = /^(?:hyperframes:\/\/|pptr:|$)/;

/**
 * A GSAP distribution file: `.../gsap@<version>/dist/<file>.js` (the CDN, which
 * the compiler inlines under that address, or a `node_modules/gsap/dist` copy)
 * or a local `gsap.js` / `gsap.min.js` / `gsap-core.js`. GSAP bundled into a
 * script of the page's own is the page's: its renders count.
 */
const GSAP_SCRIPT_URL =
  /(?:\/gsap(?:@[^/]*)?\/dist\/[A-Za-z0-9-]+|(?:^|\/)gsap(?:-core)?)(?:\.min)?\.js(?:[?#].*)?$/;

/** Whether page code, not the renderer or GSAP, could have run in this script. */
export function isPageScript(url: string): boolean {
  return !RENDERER_SCRIPT_URL.test(url) && !GSAP_SCRIPT_URL.test(url);
}

/**
 * The page functions that ran in a precise call-count report, as a log
 * detail, or `null` when only the renderer and GSAP ran.
 */
export function findPageCodeInCoverage(scripts: readonly ScriptCoverageLike[]): string | null {
  let count = 0;
  let first: string | undefined;
  for (const script of scripts) {
    if (!isPageScript(script.url)) continue;
    for (const fn of script.functions) {
      if (!((fn.ranges[0]?.count ?? 0) > 0)) continue;
      count += 1;
      first ??= `${fn.functionName || "an anonymous function"} in ${script.url}`;
    }
  }
  return first === undefined ? null : `${count} page function(s) ran on seeks, first ${first}`;
}

/** A running call-count record; `stop()` ends it and reports what page code ran. */
export interface PageCodeWatch {
  /** `findPageCodeInCoverage` of everything since `watchPageCode`, or why it cannot say. */
  stop(): Promise<string | null>;
  /** Ends the record without reading it; never throws. */
  dispose(): Promise<void>;
}

/**
 * Start counting calls on the overlay page. Uses the page's cached engine
 * CDP session and never detaches it (see `findSeekHookListeners`). Starting
 * precise coverage resets V8's call counts, so only calls made after this
 * returns are reported. A record that cannot be read is reported too:
 * unread is not empty.
 */
export async function watchPageCode(page: CaptureSession["page"]): Promise<PageCodeWatch> {
  const client = await getCdpSession(page);
  let stopped = false;
  const end = async () => {
    if (stopped) return;
    stopped = true;
    await client.send("Profiler.stopPreciseCoverage").catch(() => undefined);
    await client.send("Profiler.disable").catch(() => undefined);
  };
  let startError: string | undefined;
  try {
    await client.send("Profiler.enable");
    await client.send("Profiler.startPreciseCoverage", { callCount: true, detailed: false });
    // Counts from before the start (a record another caller left running) are dropped here.
    await client.send("Profiler.takePreciseCoverage");
  } catch (error) {
    startError = error instanceof Error ? error.message : String(error);
  }
  return {
    async stop() {
      if (startError !== undefined) {
        await end();
        return `call counts unavailable (${startError})`;
      }
      try {
        const { result } = await client.send("Profiler.takePreciseCoverage");
        return findPageCodeInCoverage(result);
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
