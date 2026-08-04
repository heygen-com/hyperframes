#!/usr/bin/env node
/**
 * What a project costs while it is merely open.
 *
 * Open time is a single number at a single instant; it cannot see idle CPU,
 * per-scrub-frame work, request amplification, or memory retained across
 * project switches. This gate measures those four directly, against a fixture
 * carrying real media that many clips share.
 *
 *   STUDIO_URL=http://localhost:5190 \
 *     bun packages/studio/tests/e2e/studio-runtime-cost.mjs
 *
 * Run under bun, not node: the budgets are imported from their TypeScript home
 * so the gate and the app read one owner rather than two copies of the numbers.
 *
 * STUDIO_URL is the Studio origin, not a project URL. The gate owns its
 * fixtures: it writes two generated projects into `data/projects/` (gitignored)
 * and drives them itself, so a run is one command and the switch window has two
 * projects to alternate.
 *
 * STUDIO_RUNTIME_WINDOWS selects which windows run, for iterating on one of
 * them without paying for the others. STUDIO_RUNTIME_TIER=ci relaxes only the
 * idle CPU ceiling and the readiness timeout — a shared runner is slower and
 * noisier than the machine the strict numbers were recorded on. Counting
 * assertions are deterministic and are never relaxed.
 *
 * Everything the gate reports is measured in a browser. A window that cannot
 * run fails; it never falls back to a partial or synthesized number.
 */
import { cpus, platform, arch, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { resolveChromeExecutable } from "./puppeteerEnv.mjs";
import { writeStudioLoadFixture } from "./generateStudioLoadFixture.mjs";
import {
  STUDIO_RUNTIME_BUDGETS,
  findIdleQuiescentWindow,
} from "../../src/lib/studioRuntimeBudgets.ts";

const ALL_WINDOWS = ["idle", "scrub", "open", "switch"];
const TIERS = ["primary", "ci"];

const STUDIO_URL = process.env.STUDIO_URL;
const TIER = process.env.STUDIO_RUNTIME_TIER || "primary";
const WINDOWS = (process.env.STUDIO_RUNTIME_WINDOWS || ALL_WINDOWS.join(","))
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

if (!STUDIO_URL) {
  console.error(
    "STUDIO_URL is required and must be the origin of a running Studio, e.g. " +
      "http://localhost:5190",
  );
  process.exit(2);
}
if (!TIERS.includes(TIER)) {
  console.error(`STUDIO_RUNTIME_TIER must be one of: ${TIERS.join(", ")}`);
  process.exit(2);
}
const unknownWindows = WINDOWS.filter((name) => !ALL_WINDOWS.includes(name));
if (WINDOWS.length === 0 || unknownWindows.length > 0) {
  console.error(
    `STUDIO_RUNTIME_WINDOWS must be a comma-separated subset of: ${ALL_WINDOWS.join(", ")}` +
      (unknownWindows.length > 0 ? ` (received: ${unknownWindows.join(", ")})` : ""),
  );
  process.exit(2);
}

const budgets = STUDIO_RUNTIME_BUDGETS;
const idleCpuBudget =
  TIER === "ci" ? budgets.constrainedIdleCpuFractionOfCore : budgets.idleCpuFractionOfCore;
const readyTimeoutMs = TIER === "ci" ? budgets.constrainedReadyTimeoutMs : budgets.readyTimeoutMs;

/**
 * The two fixture projects. They differ in clip count so a switch is observable
 * from the DOM rather than assumed from the URL, and both carry media reused
 * seven times per source — the shape that produces request amplification.
 */
const GENERATED_FIXTURES = [
  {
    id: "studio-runtime-cost-a",
    clipCount: 133,
    trackCount: 12,
    mediaSourceCount: 20,
    mediaClipCount: 140,
  },
  {
    id: "studio-runtime-cost-b",
    clipCount: 90,
    trackCount: 12,
    mediaSourceCount: 15,
    mediaClipCount: 105,
  },
];
const MEDIA_EXTENSIONS = /\.(mp4|m4a|mov|webm|mp3|wav|ogg|aac|flac)(\?|$)/i;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i;

/**
 * STUDIO_RUNTIME_PROJECTS points the gate at projects already on disk instead of
 * the generated fixtures. The gate runs on the fixture; this exists so the same
 * four windows can be read against a real project and the two compared, because
 * a synthesized project's tiny files can change fetch and caching behaviour.
 */
const PROJECT_OVERRIDE = (process.env.STUDIO_RUNTIME_PROJECTS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
if (PROJECT_OVERRIDE.length > 2) {
  console.error(
    "STUDIO_RUNTIME_PROJECTS accepts at most two project ids: one to measure, one to alternate with",
  );
  process.exit(2);
}
if (PROJECT_OVERRIDE.length === 1 && WINDOWS.includes("switch")) {
  console.error(
    "STUDIO_RUNTIME_PROJECTS needs two project ids when the switch window runs; " +
      "a switch measurement alternates two projects",
  );
  process.exit(2);
}
const FIXTURES =
  PROJECT_OVERRIDE.length > 0
    ? PROJECT_OVERRIDE.map((id) => ({ id, generated: false }))
    : GENERATED_FIXTURES;

/** The messages of every exceeded budget, from `[exceeded, message]` pairs. */
function failuresFrom(checks) {
  return checks.filter(([exceeded]) => exceeded).map(([, message]) => message);
}

/**
 * Counts requestAnimationFrame scheduling and full-document media queries, by
 * call site, in every frame.
 *
 * Installed through `evaluateOnNewDocument`, so it runs before any application
 * script in the top document AND in the preview iframe — the frame the media
 * queries actually happen in. Attribution by call site is the point: a bare
 * count says a regression exists, a call site says where.
 */
function installStudioRuntimeCostProbe() {
  const state = {
    enabled: false,
    animationFrameCallsBySite: Object.create(null),
    fullDocumentMediaQueries: 0,
    fullDocumentMediaQueriesBySite: Object.create(null),
  };
  window.__studioRuntimeCostProbe = state;

  function studioRuntimeCostCallSite() {
    // A short stack is the difference between attribution costing nothing and
    // the probe showing up in the CPU number it is measuring. Four frames reach
    // the caller; the limit is restored immediately so nothing else sees it.
    const previousLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 4;
    const stack = String(new Error().stack || "");
    Error.stackTraceLimit = previousLimit;
    const line = stack
      .split("\n")
      .map((raw) => raw.trim())
      .find((raw) => raw.startsWith("at ") && !raw.includes("studioRuntimeCost"));
    return line === undefined
      ? "unattributed"
      : line
          .replace(/^at\s+/, "")
          .replace(/\?[^\s):]*/g, "")
          .replace(/https?:\/\/[^/]+\//g, "")
          .slice(0, 160);
  }

  function studioRuntimeCostRecord(bucket, site) {
    bucket[site] = (bucket[site] || 0) + 1;
  }

  // A steady-state animation loop reschedules the same function object every
  // frame, so its call site is captured once and read from the map thereafter.
  // Two sites sharing one function object are attributed to the first — a
  // trade the idle CPU number is worth, since a stack per frame would put the
  // probe itself into the measurement.
  const siteByCallback = new WeakMap();
  function studioRuntimeCostSiteFor(callback) {
    if (typeof callback !== "function") return studioRuntimeCostCallSite();
    const cached = siteByCallback.get(callback);
    if (cached !== undefined) return cached;
    const site = studioRuntimeCostCallSite();
    siteByCallback.set(callback, site);
    return site;
  }

  const nativeRequestAnimationFrame = window.requestAnimationFrame;
  window.requestAnimationFrame = function studioRuntimeCostRaf(callback) {
    if (state.enabled) {
      studioRuntimeCostRecord(state.animationFrameCallsBySite, studioRuntimeCostSiteFor(callback));
    }
    return nativeRequestAnimationFrame.call(window, callback);
  };

  // A full-document media query is one issued on a Document (not an element
  // subtree) whose selector list contains a `video` or `audio` type selector —
  // `video, audio` and `audio[data-start]` both qualify. That is the scan the
  // runtime performs per seek, and the one this gate exists to drive to zero.
  const nativeQuerySelectorAll = Document.prototype.querySelectorAll;
  Document.prototype.querySelectorAll = function studioRuntimeCostQsa(selectors) {
    if (state.enabled) {
      const isMediaSelector = String(selectors)
        .split(",")
        .some((part) => /^(video|audio)\b/i.test(part.trim()));
      if (isMediaSelector) {
        state.fullDocumentMediaQueries += 1;
        studioRuntimeCostRecord(state.fullDocumentMediaQueriesBySite, studioRuntimeCostCallSite());
      }
    }
    return nativeQuerySelectorAll.call(this, selectors);
  };
}

async function forEachFrame(page, fn) {
  const results = [];
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    try {
      results.push({ url: frame.url(), value: await frame.evaluate(fn) });
    } catch {
      // A frame torn down mid-read contributes nothing rather than failing the
      // run; the frames that matter here outlive every window.
    }
  }
  return results;
}

async function setProbeEnabled(page, enabled) {
  await Promise.all(
    page.frames().map(async (frame) => {
      if (frame.isDetached()) return;
      try {
        await frame.evaluate((on) => {
          if (window.__studioRuntimeCostProbe) window.__studioRuntimeCostProbe.enabled = on;
        }, enabled);
      } catch {
        /* detached */
      }
    }),
  );
}

async function resetProbe(page) {
  await Promise.all(
    page.frames().map(async (frame) => {
      if (frame.isDetached()) return;
      try {
        await frame.evaluate(() => {
          const probe = window.__studioRuntimeCostProbe;
          if (!probe) return;
          probe.animationFrameCallsBySite = Object.create(null);
          probe.fullDocumentMediaQueries = 0;
          probe.fullDocumentMediaQueriesBySite = Object.create(null);
        });
      } catch {
        /* detached */
      }
    }),
  );
}

async function readProbe(page) {
  const frames = await forEachFrame(page, () => {
    const probe = window.__studioRuntimeCostProbe;
    if (!probe) return null;
    return {
      animationFrameCallsBySite: { ...probe.animationFrameCallsBySite },
      fullDocumentMediaQueries: probe.fullDocumentMediaQueries,
      fullDocumentMediaQueriesBySite: { ...probe.fullDocumentMediaQueriesBySite },
    };
  });
  const present = frames.filter((frame) => frame.value !== null);
  if (present.length === 0) {
    throw new Error("The runtime-cost probe is installed in no frame; nothing was measured");
  }
  const byFrame = present.map(({ url, value }) => ({ frame: describeFrame(url), ...value }));
  return {
    byFrame,
    animationFrameCalls: byFrame.reduce(
      (total, frame) => total + sumCounts(frame.animationFrameCallsBySite),
      0,
    ),
    fullDocumentMediaQueries: byFrame.reduce(
      (total, frame) => total + frame.fullDocumentMediaQueries,
      0,
    ),
  };
}

function describeFrame(url) {
  return url.includes("/preview") ? "preview-iframe" : "studio-document";
}

function sumCounts(bucket) {
  return Object.values(bucket).reduce((total, count) => total + count, 0);
}

function topSites(bucket, limit = 8) {
  return Object.fromEntries(
    Object.entries(bucket)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit),
  );
}

async function readPerformanceMetrics(client) {
  const { metrics } = await client.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
}

function projectUrl(id) {
  return `${STUDIO_URL.replace(/\/$/, "")}/#project/${id}`;
}

/**
 * Interactive means the timeline has mounted the project's elements AND the
 * preview iframe has a composition in it. A project that never reaches both
 * fails here on timeout rather than contributing a partial number downstream.
 */
async function waitForProjectInteractive(page, expectedClipsAtLeast) {
  const deadline = Date.now() + readyTimeoutMs;
  let lastObserved = null;
  while (Date.now() < deadline) {
    lastObserved = await readInteractiveState(page);
    if (lastObserved.timelineElements >= expectedClipsAtLeast && lastObserved.previewElements > 0) {
      return lastObserved;
    }
    await sleep(250);
  }
  throw new Error(
    `Studio never became interactive within ${readyTimeoutMs}ms: ${JSON.stringify(lastObserved)}`,
  );
}

async function readInteractiveState(page) {
  const top = await page
    .evaluate(() => {
      const timeline = document.querySelector('[aria-label="Timeline"]');
      return {
        timelineElements: Number(timeline?.getAttribute("data-timeline-element-count") ?? -1),
        mountedClips: document.querySelectorAll('[data-clip="true"]').length,
      };
    })
    .catch(() => ({ timelineElements: -1, mountedClips: 0 }));
  let previewElements = 0;
  for (const frame of page.frames()) {
    if (frame === page.mainFrame() || frame.isDetached()) continue;
    previewElements = Math.max(
      previewElements,
      // A composition root, not a clip count: a project may legitimately render
      // its clips into sub-compositions, and a readiness signal that misses
      // those would time out on a project that is in fact open.
      await frame
        .evaluate(() => document.querySelectorAll("[data-composition-id], .clip").length)
        .catch(() => 0),
    );
  }
  return { ...top, previewElements };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Windows ──────────────────────────────────────────────────────────────────

/**
 * Idle, past quiescence.
 *
 * Consecutive windows are sampled until the style-recalc count stabilises; the
 * first windows on a media project drain the thumbnail-extraction backlog and
 * read several times the steady state. Reporting the first window would gate on
 * a transient, so the quiescence condition — not an elapsed time — decides which
 * window is the answer.
 */
async function sampleIdleWindow(page, client, index, before) {
  const windowSeconds = budgets.idleWindowMs / 1000;
  await resetProbe(page);
  await setProbeEnabled(page, true);
  await sleep(budgets.idleWindowMs);
  const probe = await readProbe(page);
  await setProbeEnabled(page, false);
  const after = await readPerformanceMetrics(client);
  return {
    after,
    sample: {
      windowIndex: index,
      styleRecalcs: after.RecalcStyleCount - before.RecalcStyleCount,
      layouts: after.LayoutCount - before.LayoutCount,
      cpuFractionOfCore: (after.TaskDuration - before.TaskDuration) / windowSeconds,
      animationFrameCalls: probe.animationFrameCalls,
      animationFrameCallsByFrame: probe.byFrame.map((frame) => ({
        frame: frame.frame,
        calls: sumCounts(frame.animationFrameCallsBySite),
        topSites: topSites(frame.animationFrameCallsBySite),
      })),
      nodes: after.Nodes,
      jsEventListeners: after.JSEventListeners,
      jsHeapUsedBytes: after.JSHeapUsedSize,
    },
  };
}

function quiescentIndexOf(samples) {
  return findIdleQuiescentWindow(
    samples.map((sample) => sample.styleRecalcs),
    budgets,
  );
}

function summariseIdleWindow(settled, quiescentIndex) {
  const windowSeconds = budgets.idleWindowMs / 1000;
  return {
    quiescentWindowIndex: quiescentIndex,
    cpuFractionOfCore: round(settled.cpuFractionOfCore, 4),
    styleRecalcsPerSecond: round(settled.styleRecalcs / windowSeconds, 2),
    layoutsPerSecond: round(settled.layouts / windowSeconds, 2),
    animationFrameCallsPerSecond: round(settled.animationFrameCalls / windowSeconds, 2),
    animationFrameCallSites: settled.animationFrameCallsByFrame,
  };
}

function idleFailures(measured) {
  return failuresFrom([
    [
      measured.cpuFractionOfCore > idleCpuBudget,
      `idle CPU ${(measured.cpuFractionOfCore * 100).toFixed(1)}% of a core exceeds ` +
        `${(idleCpuBudget * 100).toFixed(1)}%`,
    ],
    [
      measured.styleRecalcsPerSecond > budgets.idleStyleRecalcsPerSecond,
      `idle style recalcs ${measured.styleRecalcsPerSecond}/s exceeds ` +
        `${budgets.idleStyleRecalcsPerSecond}/s`,
    ],
    [
      measured.layoutsPerSecond > budgets.idleLayoutsPerSecond,
      `idle layouts ${measured.layoutsPerSecond}/s exceeds ${budgets.idleLayoutsPerSecond}/s`,
    ],
    [
      measured.animationFrameCallsPerSecond > budgets.idleAnimationFrameCallsPerSecond,
      `idle animation-frame calls ${measured.animationFrameCallsPerSecond}/s exceeds ` +
        `${budgets.idleAnimationFrameCallsPerSecond}/s`,
    ],
  ]);
}

async function measureIdle(page, client) {
  const samples = [];
  let before = await readPerformanceMetrics(client);
  for (let index = 0; index < budgets.idleMaxWindows; index += 1) {
    const { after, sample } = await sampleIdleWindow(page, client, index, before);
    samples.push(sample);
    before = after;
    if (quiescentIndexOf(samples) !== null) break;
  }
  const quiescentIndex = quiescentIndexOf(samples);
  if (quiescentIndex === null) {
    return {
      windows: samples,
      quiescent: false,
      failures: [
        `idle never reached quiescence across ${samples.length} windows of ` +
          `${budgets.idleWindowMs}ms: recalcs ${samples.map((s) => s.styleRecalcs).join(", ")}`,
      ],
    };
  }
  const measured = summariseIdleWindow(samples[quiescentIndex], quiescentIndex);
  return { windows: samples, quiescent: true, measured, failures: idleFailures(measured) };
}

/**
 * Scrub: drag the playhead a fixed distance across the timeline ruler and count
 * the full-document media queries the drag causes — in every frame, because the
 * scan happens inside the preview iframe, not the top document.
 */
async function readScrubSurface(page) {
  const ruler = await page.evaluate(() => {
    const viewport = document.querySelector("[data-timeline-scroll-viewport]");
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  if (!ruler || ruler.width < budgets.scrubDistancePx + 40) {
    throw new Error(
      `The timeline scroll viewport is missing or too narrow to drag ${budgets.scrubDistancePx}px: ` +
        JSON.stringify(ruler),
    );
  }
  // The ruler strip at the top of the viewport is the scrub surface; a press
  // lower down draws a marquee instead and would measure nothing.
  return { startX: ruler.x + 20, y: ruler.y + 6 };
}

async function dragPlayhead(page, { startX, y }) {
  await page.mouse.move(startX, y);
  await page.mouse.down();
  for (let step = 1; step <= budgets.scrubSteps; step += 1) {
    await page.mouse.move(startX + (budgets.scrubDistancePx * step) / budgets.scrubSteps, y);
    await sleep(16);
  }
  await page.mouse.up();
  await sleep(200);
}

async function measureScrub(page) {
  const surface = await readScrubSurface(page);
  await resetProbe(page);
  await setProbeEnabled(page, true);
  await dragPlayhead(page, surface);
  const probe = await readProbe(page);
  await setProbeEnabled(page, false);

  const measured = {
    fullDocumentMediaQueries: probe.fullDocumentMediaQueries,
    perStep: round(probe.fullDocumentMediaQueries / budgets.scrubSteps, 2),
    byFrame: probe.byFrame.map((frame) => ({
      frame: frame.frame,
      fullDocumentMediaQueries: frame.fullDocumentMediaQueries,
      topSites: topSites(frame.fullDocumentMediaQueriesBySite),
    })),
  };
  return {
    measured,
    failures: failuresFrom([
      [
        measured.fullDocumentMediaQueries > budgets.scrubFullDocumentMediaQueries,
        `scrub issued ${measured.fullDocumentMediaQueries} full-document media queries, ` +
          `budget ${budgets.scrubFullDocumentMediaQueries}`,
      ],
    ]),
  };
}

/**
 * Open: every request the browser makes from a cold navigation until the
 * network goes quiet, and how many times each distinct media file is fetched.
 */
/** Every completed request on this page, with the bytes that crossed the wire. */
async function recordRequests(client) {
  const pending = new Map();
  const completed = [];
  const activity = { at: Date.now() };
  const finish = (requestId, bytes) => {
    const request = pending.get(requestId);
    if (!request) return;
    pending.delete(requestId);
    completed.push({ ...request, bytes: bytes ?? 0 });
    activity.at = Date.now();
  };
  await client.send("Network.enable");
  client.on("Network.requestWillBeSent", ({ requestId, request, type }) => {
    const headers = request.headers ?? {};
    const ranged = Boolean(headers.Range ?? headers.range);
    pending.set(requestId, { url: request.url, type, ranged });
    activity.at = Date.now();
  });
  client.on("Network.loadingFinished", ({ requestId, encodedDataLength }) =>
    finish(requestId, encodedDataLength),
  );
  client.on("Network.loadingFailed", ({ requestId }) => finish(requestId, 0));
  return { completed, activity };
}

async function waitForNetworkQuiet(activity) {
  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() - activity.at < budgets.openQuietPeriodMs) {
    if (Date.now() > deadline) {
      throw new Error(
        `Network never went quiet for ${budgets.openQuietPeriodMs}ms within ${readyTimeoutMs}ms`,
      );
    }
    await sleep(250);
  }
}

/**
 * A media element fetches one file as a series of ranged reads — that is normal
 * playback behaviour, not duplication. Counting raw HTTP requests therefore
 * reports a file pulled once in eight chunks as "8x amplification", and gets
 * WORSE when a fix defers a source so it is later fetched in pieces.
 *
 * What this gate is for is wasted fetching: the same source pulled from scratch
 * by independent subsystems that do not share a cache. So ranged reads of one
 * URL collapse into a single logical fetch, and the ratio is built from those.
 * Raw counts stay in the output as diagnostics.
 */
function countLogicalFetches(requests) {
  const rangedUrls = new Set();
  let fetches = 0;
  for (const request of requests) {
    const url = request.url.split("?")[0];
    if (!request.ranged) {
      fetches += 1;
      continue;
    }
    if (rangedUrls.has(url)) continue;
    rangedUrls.add(url);
    fetches += 1;
  }
  return fetches;
}

function summariseRequests(completed, wallClockMs) {
  const media = completed.filter((request) => MEDIA_EXTENSIONS.test(request.url));
  const images = completed.filter((request) => IMAGE_EXTENSIONS.test(request.url));
  const distinct = (requests) => new Set(requests.map((request) => request.url.split("?")[0])).size;
  const distinctMediaSources = distinct(media);
  const mediaFetches = countLogicalFetches(media);
  if (distinctMediaSources === 0) {
    throw new Error("No media requests observed; the project under test carries no media");
  }
  const sumBytes = (requests) => requests.reduce((total, request) => total + request.bytes, 0);
  return {
    wallClockMs,
    requests: completed.length,
    bytes: sumBytes(completed),
    mediaRequests: media.length,
    mediaRangedRequests: media.filter((request) => request.ranged).length,
    mediaFetches,
    mediaBytes: sumBytes(media),
    distinctMediaSources,
    mediaRequestsPerDistinctSource: round(mediaFetches / distinctMediaSources, 2),
    imageRequests: images.length,
    distinctImageSources: distinct(images),
  };
}

async function measureOpen(browser) {
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    // The cache is deliberately left ON. A fresh browser context already starts
    // cold, and disabling the cache would turn every same-source refetch into a
    // network request — inflating the amplification ratio into a number no user
    // ever pays. What is measured here is a cold open with the cache a real
    // session has.
    const client = await page.createCDPSession();
    const { completed, activity } = await recordRequests(client);
    const startedAt = Date.now();
    await page.goto(projectUrl(FIXTURES[0].id), {
      waitUntil: "domcontentloaded",
      timeout: readyTimeoutMs,
    });
    await waitForProjectInteractive(page, 1);
    await waitForNetworkQuiet(activity);
    const measured = summariseRequests(completed, Date.now() - startedAt);
    return {
      measured,
      failures: failuresFrom([
        [
          measured.mediaRequestsPerDistinctSource > budgets.openMediaRequestsPerDistinctSource,
          `open fetched each media source ${measured.mediaRequestsPerDistinctSource}x, ` +
            `budget ${budgets.openMediaRequestsPerDistinctSource}x`,
        ],
      ]),
    };
  } finally {
    await context.close();
  }
}

/**
 * Switch: alternate two projects with a forced collection between samples and
 * report the heap retained per cycle. DOM nodes, listeners and documents are
 * reported alongside so a heap climb with flat node counts reads as what it is.
 */
async function sampleSwitchCycle(page, client, cycle) {
  const fixture = FIXTURES[cycle % FIXTURES.length];
  await page.evaluate((url) => {
    window.location.hash = url;
  }, `#project/${fixture.id}`);
  await waitForProjectInteractive(page, 1);
  await sleep(1_000);
  await client.send("HeapProfiler.collectGarbage");
  const { usedSize } = await client.send("Runtime.getHeapUsage");
  const metrics = await readPerformanceMetrics(client);
  return {
    cycle,
    project: fixture.id,
    jsHeapUsedBytes: usedSize,
    nodes: metrics.Nodes,
    jsEventListeners: metrics.JSEventListeners,
    documents: metrics.Documents,
  };
}

async function measureSwitch(page, client) {
  const cycles = [];
  for (let cycle = 0; cycle < budgets.switchCycles; cycle += 1) {
    cycles.push(await sampleSwitchCycle(page, client, cycle));
  }
  // The first switch mounts what the session needs; retention is the slope
  // after it, not the step onto it.
  const measurable = cycles.slice(1);
  const heapDeltaBytes =
    measurable[measurable.length - 1].jsHeapUsedBytes - measurable[0].jsHeapUsedBytes;
  // DOM counts are compared across cycles showing the SAME project. The two
  // fixtures differ in clip count, so an a-to-b comparison would report their
  // shape difference as retention.
  const sameProject = cycles.filter((cycle) => cycle.project === cycles[cycles.length - 1].project);
  const drift = (key) => sameProject[sameProject.length - 1][key] - sameProject[0][key];
  const measured = {
    cycles,
    heapDeltaBytes,
    heapBytesPerCycle: round(heapDeltaBytes / (measurable.length - 1), 0),
    nodeDriftSameProject: drift("nodes"),
    listenerDriftSameProject: drift("jsEventListeners"),
    documentDriftSameProject: drift("documents"),
  };
  return {
    measured,
    failures: failuresFrom([
      [
        measured.heapBytesPerCycle > budgets.switchHeapBytesPerCycle,
        `switch retained ${formatBytes(measured.heapBytesPerCycle)} per cycle, ` +
          `budget ${formatBytes(budgets.switchHeapBytesPerCycle)}`,
      ],
    ]),
  };
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ── Run ──────────────────────────────────────────────────────────────────────

const executablePath = resolveChromeExecutable();
if (!executablePath) {
  console.error("No Chrome executable found. Set PUPPETEER_EXECUTABLE_PATH or CHROME_PATH.");
  process.exit(2);
}

// `data/projects/` is gitignored; generated fixtures never enter the tree.
const projectsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "projects");
for (const { id, generated, ...options } of FIXTURES) {
  if (generated === false) continue;
  writeStudioLoadFixture(join(projectsDir, id), options);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1600,1000"],
  defaultViewport: { width: 1600, height: 1000 },
});
let exitCode = 1;
const results = {};
const failures = [];
let version = "unknown";
try {
  version = await browser.version();

  if (WINDOWS.includes("open")) {
    const open = await measureOpen(browser);
    results.open = open.measured;
    failures.push(...open.failures);
  }

  if (WINDOWS.some((name) => ["idle", "scrub", "switch"].includes(name))) {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 200)));
    await page.evaluateOnNewDocument(installStudioRuntimeCostProbe);
    const client = await page.createCDPSession();
    await client.send("Performance.enable");
    await page.goto(projectUrl(FIXTURES[0].id), {
      waitUntil: "domcontentloaded",
      timeout: readyTimeoutMs,
    });
    results.interactive = await waitForProjectInteractive(page, 1);

    if (WINDOWS.includes("idle")) {
      const idle = await measureIdle(page, client);
      results.idle = idle;
      failures.push(...idle.failures);
    }
    if (WINDOWS.includes("scrub")) {
      const scrub = await measureScrub(page);
      results.scrub = scrub.measured;
      failures.push(...scrub.failures);
    }
    if (WINDOWS.includes("switch")) {
      const switched = await measureSwitch(page, client);
      results.switch = switched.measured;
      failures.push(...switched.failures);
    }
    results.pageErrors = pageErrors;
    await page.close();
  }
} catch (error) {
  // A window that cannot run says why and fails. It contributes no measurement:
  // a number read off a page that never became interactive would gate on
  // nothing while looking like evidence.
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  const evidence = {
    environment: {
      browser: version,
      executablePath,
      os: platform(),
      architecture: arch(),
      cores: cpus().length,
      totalMemoryBytes: totalmem(),
      tier: TIER,
      windows: WINDOWS,
      studioUrl: STUDIO_URL,
      fixtures: FIXTURES,
      appliedBudgets: {
        idleCpuFractionOfCore: idleCpuBudget,
        idleStyleRecalcsPerSecond: budgets.idleStyleRecalcsPerSecond,
        idleLayoutsPerSecond: budgets.idleLayoutsPerSecond,
        idleAnimationFrameCallsPerSecond: budgets.idleAnimationFrameCallsPerSecond,
        scrubFullDocumentMediaQueries: budgets.scrubFullDocumentMediaQueries,
        openMediaRequestsPerDistinctSource: budgets.openMediaRequestsPerDistinctSource,
        switchHeapBytesPerCycle: budgets.switchHeapBytesPerCycle,
        readyTimeoutMs,
      },
    },
    results,
    failures,
  };
  console.log(JSON.stringify(evidence, null, 2));
  exitCode = failures.length === 0 ? 0 : 1;
  if (failures.length > 0) console.error(`\nFAIL: ${failures.join("; ")}`);
  else console.error("\nPASS");
  await browser.close();
}
process.exit(exitCode);
