/**
 * HDR passthrough: the overlay page checks that run nothing the page can
 * reach, in the order the passthrough needs them.
 *
 * `inspectPageState` reads, through DevTools only, what the page registered
 * while it loaded (on the capture page, which is never paused, as a census
 * that matches the analysis page's), scripts compiled where only the renderer's
 * should be, builtins the page replaced, and what a seek runs that the page
 * provided (listeners, GSAP's callbacks and targets, the runtime's globals). It runs
 * before any of the passthrough's in-page probes: until it passes, a probe
 * that runs in the page could call a builtin the page swapped for one with
 * side effects.
 *
 * `inspectPageContent` reads what paints: the DevTools DOM snapshot (content
 * the fingerprint cannot read, other videos, the element allowlist), the
 * stylesheets (in the isolated world) and the images the page loaded.
 */

import { type CaptureSession, getCdpSession } from "@hyperframes/engine";
import {
  compareLoadCensus,
  findForeignObserver,
  type LoadCensus,
  readLoadCensus,
} from "./loadCensus.js";
import { CAPTURE_OBJECT_GROUP, findChangedIntrinsics, MainWorld } from "./mainWorld.js";
import { findUnsupportedCss, findUnsupportedElements } from "./ownClock.js";
import {
  captureDomSnapshot,
  findBlindSpotsInSnapshot,
  findOwnClockElementsInSnapshot,
  setFingerprintTargets,
} from "./overlayFingerprint.js";
import { pageCodeWatchOf } from "./pageCodeWatch.js";
import { readSeekReachable } from "./seekReachable.js";
import type { PassthroughIneligibleReason } from "./types.js";

type Page = CaptureSession["page"];

export interface PageFinding {
  reason: PassthroughIneligibleReason;
  detail: string;
}

/** Time spent in the gates per overlay page, for the render log. */
const gateMs = new WeakMap<Page, { state: number[]; content: number[] }>();

function timed<T>(page: Page, kind: "state" | "content", run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  return run().finally(() => {
    const entry = gateMs.get(page) ?? { state: [], content: [] };
    entry[kind].push(Date.now() - started);
    gateMs.set(page, entry);
  });
}

/** Milliseconds each gate run took on this page so far. */
export function pageGateTimings(page: Page): { state: number[]; content: number[] } {
  return gateMs.get(page) ?? { state: [], content: [] };
}

const seekCallback = (detail: string): PageFinding => ({ reason: "seek_callback", detail });

/** Each overlay page's census, read on its first state gate (ready, not seeked yet). */
const censuses = new WeakMap<Page, LoadCensus>();

/** The census the first `inspectPageState` on `page` read (`loadCensus.ts`). */
export function loadCensusOf(page: Page): LoadCensus | undefined {
  return censuses.get(page);
}

/**
 * The DevTools-only gates (see the module comment), or null. Also hands the
 * elements GSAP writes to the fingerprint (`setFingerprintTargets`). A read
 * that fails is a finding: unread is not empty. The first call on a page
 * reads its load census (`loadCensus.ts`): every observer must run the
 * renderer's script, and on the capture page the census must match
 * `analysisCensus`, the analysis page's.
 */
export function inspectPageState(
  page: Page,
  analysisCensus?: LoadCensus,
): Promise<PageFinding | null> {
  return timed(page, "state", () => readPageState(page, analysisCensus));
}

// fallow-ignore-next-line complexity
async function readPageState(
  page: Page,
  analysisCensus: LoadCensus | undefined,
): Promise<PageFinding | null> {
  const watch = pageCodeWatchOf(page);
  if (!watch) return seekCallback("no page code watch");
  const unavailable =
    watch.origins.failure() ?? watch.registrations.failure() ?? watch.resources.failure();
  if (unavailable) return seekCallback(unavailable);
  const registered = watch.registrations.findings();
  if (registered) return seekCallback(registered);
  if (watch.role === "capture" && !analysisCensus) {
    return seekCallback("no load census from the analysis page");
  }
  const compiled = await watch.origins.findUntrustedCompiles();
  if (compiled) return seekCallback(compiled);
  const captureId = watch.registrations.captureId();
  if (!captureId) return seekCallback("the document's builtins were never captured");
  try {
    const world = new MainWorld(await getCdpSession(page), captureId, CAPTURE_OBJECT_GROUP);
    let census = censuses.get(page);
    if (!census) {
      census = await readLoadCensus(page, world, watch.origins);
      censuses.set(page, census);
    }
    const foreign = findForeignObserver(census);
    if (foreign) return seekCallback(foreign);
    if (census.changed) return seekCallback(census.changed);
    if (watch.role === "capture" && analysisCensus) {
      const differs = compareLoadCensus(analysisCensus, census);
      if (differs) return seekCallback(differs);
    }
    const replaced = await findChangedIntrinsics(world);
    if (replaced) return seekCallback(replaced);
    const reachable = await readSeekReachable(world, watch.origins);
    if (reachable.findings.length > 0) {
      return seekCallback(
        `${reachable.findings.length} page callback(s) or GSAP state the passthrough cannot use: ${reachable.findings.slice(0, 3).join("; ")}`,
      );
    }
    if (reachable.scrollBehaviorWrites.length > 0) {
      return {
        reason: "overlay_unsupported",
        detail: `a GSAP tween writes scroll-behavior (the browser animates the scroll): ${reachable.scrollBehaviorWrites.join(", ")}`,
      };
    }
    setFingerprintTargets(page, reachable.elementTargets);
    return null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return seekCallback(`page state unreadable (${detail})`);
  }
}

/**
 * The content gates (see the module comment), or null. `final` after
 * capture: an image still loading then declines.
 */
export function inspectPageContent(
  page: Page,
  videoId: string,
  final: boolean,
): Promise<PageFinding | null> {
  return timed(page, "content", () => readPageContent(page, videoId, final));
}

// fallow-ignore-next-line complexity
async function readPageContent(
  page: Page,
  videoId: string,
  final: boolean,
): Promise<PageFinding | null> {
  const watch = pageCodeWatchOf(page);
  if (!watch) return seekCallback("no page code watch");
  let snapshot: Awaited<ReturnType<typeof captureDomSnapshot>>;
  try {
    snapshot = await captureDomSnapshot(page);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { reason: "overlay_unreadable", detail: `DOM snapshot failed (${detail})` };
  }
  const blindSpot = findBlindSpotsInSnapshot(snapshot);
  if (blindSpot) return { reason: "overlay_unreadable", detail: blindSpot };
  const ownClock = findOwnClockElementsInSnapshot(snapshot, videoId);
  if (ownClock) return ownClock;
  const element = findUnsupportedElements(snapshot);
  if (element) return { reason: "overlay_unsupported", detail: element };
  try {
    const css = await findUnsupportedCss(page, watch.resources);
    if (css) return { reason: "overlay_unsupported", detail: css };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { reason: "overlay_unreadable", detail: `stylesheets unreadable (${detail})` };
  }
  const image = await watch.resources.findUnsupportedImages(final);
  if (image) return { reason: "overlay_non_gsap_animation", detail: image };
  return null;
}
