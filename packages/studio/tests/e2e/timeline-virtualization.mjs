#!/usr/bin/env node
/**
 * Reproducible timeline viewport gate against a running Studio preview of the
 * adjacent fixture. The script prints machine-readable evidence; it never
 * substitutes synthetic timings for a browser run.
 *
 * STUDIO_URL=http://127.0.0.1:5190/#project/timeline-virtualization \
 *   node packages/studio/tests/e2e/timeline-virtualization.mjs
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir, platform, arch } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const STUDIO_URL = process.env.STUDIO_URL;
const PROFILE = process.env.TIMELINE_PROFILE || "dense-short";
const ELEMENT_COUNT = Number(process.env.TIMELINE_ELEMENT_COUNT || 50_000);
const TIER = process.env.TIMELINE_TIER || "primary";
const EXPECTED_CHROME_MAJOR = process.env.TIMELINE_CHROME_MAJOR
  ? Number(process.env.TIMELINE_CHROME_MAJOR)
  : null;

if (!STUDIO_URL) {
  console.error("STUDIO_URL is required and must point at the timeline-virtualization fixture");
  process.exit(2);
}
if (
  ![1_000, 50_000].includes(ELEMENT_COUNT) ||
  !["primary", "low-resource", "high-dpr"].includes(TIER)
) {
  console.error(
    "TIMELINE_ELEMENT_COUNT must be 1000 or 50000; " +
      "TIMELINE_TIER must be primary, low-resource, or high-dpr",
  );
  process.exit(2);
}

function resolveChromeExecutable() {
  const chromeRoot = join(homedir(), ".cache", "puppeteer", "chrome");
  const builds = existsSync(chromeRoot) ? readdirSync(chromeRoot).sort().reverse() : [];
  const installedCandidates = builds.flatMap((build) =>
    [
      "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "chrome-linux64/chrome",
    ].map((relative) => join(chromeRoot, build, relative)),
  );
  return [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    ...installedCandidates,
  ].find((candidate) => candidate && existsSync(candidate));
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function collectHeapBytes(client) {
  const usage = await client.send("Runtime.getHeapUsage");
  return usage.usedSize;
}

async function collectRun(page) {
  return page.evaluate(async () => {
    const longTasks = [];
    const longAnimationFrames = [];
    const scroller = findTimelineScroller();
    const observer = observeLongTasks(longTasks);
    const animationFrameObserver = observeLongAnimationFrames(longAnimationFrames);
    const { interactions, frameIntervals } = await measureScrollInteractions(scroller);
    observer?.disconnect();
    animationFrameObserver?.disconnect();
    return {
      interactionP95Ms: percentileInPage(interactions, 0.95),
      frameIntervalP95Ms: percentileInPage(frameIntervals, 0.95),
      longestTaskMs: Math.max(0, ...longTasks),
      longAnimationFrames: longAnimationFrames
        .sort((left, right) => right.duration - left.duration)
        .slice(0, 5),
      scrollWidth: scroller.scrollWidth,
      scrollHeight: scroller.scrollHeight,
      diagnostics: window.__studioTest.readTimelinePerformanceDiagnostics(),
    };

    function percentileInPage(values, ratio) {
      if (values.length === 0) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
    }

    function findTimelineScroller() {
      const root = document.querySelector('[aria-label="Timeline"]');
      if (!(root instanceof HTMLElement)) throw new Error("Timeline root not mounted");
      const scroller = root.querySelector("[data-timeline-scroll-viewport]");
      if (!(scroller instanceof HTMLElement)) throw new Error("Timeline scroller not mounted");
      return scroller;
    }

    function observeLongTasks(longTaskDurations) {
      if (
        typeof PerformanceObserver !== "function" ||
        !PerformanceObserver.supportedEntryTypes.includes("longtask")
      ) {
        return null;
      }
      const performanceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTaskDurations.push(entry.duration);
      });
      performanceObserver.observe({ entryTypes: ["longtask"] });
      return performanceObserver;
    }

    function observeLongAnimationFrames(entries) {
      if (
        typeof PerformanceObserver !== "function" ||
        !PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")
      ) {
        return null;
      }
      const performanceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          entries.push({
            duration: entry.duration,
            blockingDuration: entry.blockingDuration,
            scripts: entry.scripts
              .sort((left, right) => right.duration - left.duration)
              .slice(0, 5)
              .map((script) => ({
                duration: script.duration,
                forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
                functionName: script.functionName,
                invokerType: script.invokerType,
                sourceURL: script.sourceURL,
              })),
          });
        }
      });
      performanceObserver.observe({ type: "long-animation-frame", buffered: false });
      return performanceObserver;
    }

    async function measureScrollInteractions(timelineScroller) {
      const interactions = [];
      const frameIntervals = [];
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      for (const ratio of [0, 0.25, 0.5, 0.75, 1, 0.5, 0]) {
        const started = performance.now();
        timelineScroller.scrollLeft = Math.round(
          (timelineScroller.scrollWidth - timelineScroller.clientWidth) * ratio,
        );
        timelineScroller.scrollTop = Math.round(
          (timelineScroller.scrollHeight - timelineScroller.clientHeight) * ratio,
        );
        const firstFrame = await nextFrame();
        const secondFrame = await nextFrame();
        interactions.push(secondFrame - started);
        frameIntervals.push(secondFrame - firstFrame);
      }
      return { interactions, frameIntervals };
    }
  });
}

async function measureMaximumReliableScrollWidth(page) {
  return page.evaluate(() => {
    const viewportWidth = 320;
    const container = document.createElement("div");
    const content = document.createElement("div");
    container.style.cssText = `position:fixed;left:-10000px;top:0;width:${viewportWidth}px;height:1px;overflow:auto`;
    content.style.height = "1px";
    container.append(content);
    document.body.append(container);
    const reliable = (width) => {
      content.style.width = `${width}px`;
      container.scrollLeft = width;
      const expected = width - viewportWidth;
      return container.scrollWidth >= width - 1 && container.scrollLeft >= expected - 1;
    };
    let low = 0;
    let high = 64_000_000;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (reliable(middle)) low = middle;
      else high = middle;
    }
    container.remove();
    return low;
  });
}

const executablePath = resolveChromeExecutable();
if (!executablePath) {
  console.error("No Chrome executable found; set PUPPETEER_EXECUTABLE_PATH");
  process.exit(2);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
let exitCode = 1;
try {
  const version = await browser.version();
  const chromeMajor = Number(/(?:Chrome|Chromium)\/(\d+)/.exec(version)?.[1]);
  if (EXPECTED_CHROME_MAJOR !== null && chromeMajor !== EXPECTED_CHROME_MAJOR) {
    throw new Error(
      `Pinned Chrome ${EXPECTED_CHROME_MAJOR} required, received ${version}. ` +
        "Override TIMELINE_CHROME_MAJOR only when intentionally recording a new baseline.",
    );
  }
  const page = await browser.newPage();
  await page.setViewport({
    width: 1440,
    height: 900,
    deviceScaleFactor: TIER === "high-dpr" ? 2 : 1,
  });
  const client = await page.createCDPSession();
  if (TIER === "low-resource") {
    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  await page.goto(STUDIO_URL, { waitUntil: "networkidle0", timeout: 60_000 });
  await page.waitForFunction(
    () => typeof window.__studioTest?.loadTimelinePerformanceFixture === "function",
    { timeout: 30_000 },
  );
  await waitForStudioTestHookSettle(page);
  const budgets = await page.evaluate(() => window.__studioTest.timelineViewportBudgets);

  const summary = await loadFixtureAndWait(page, ELEMENT_COUNT, PROFILE);
  for (let index = 0; index < budgets.warmupRuns; index += 1) {
    await collectRun(page);
  }
  await client.send("HeapProfiler.collectGarbage");
  const baselineHeapBytes = await collectHeapBytes(client);

  const measuredMaxReliableScrollWidth = await measureMaximumReliableScrollWidth(page);

  const runs = [];
  const interactionLimitMs =
    TIER === "primary" ? budgets.interactionP95Ms : budgets.constrainedInteractionP95Ms;
  const frameIntervalLimitMs =
    TIER === "primary" ? budgets.frameIntervalP95Ms : budgets.constrainedFrameIntervalP95Ms;
  for (let index = 0; index < budgets.measuredRuns; index += 1) {
    runs.push(await collectRun(page));
  }
  for (const run of runs) {
    run.passed =
      run.interactionP95Ms <= interactionLimitMs &&
      run.frameIntervalP95Ms <= frameIntervalLimitMs &&
      run.longestTaskMs <= budgets.longTaskLimitMs &&
      run.diagnostics.mountedClipRoots <= budgets.maxMountedClipRoots &&
      run.diagnostics.maxMountedClipRootsInOneRow <= budgets.maxMountedClipRootsPerRow &&
      run.diagnostics.mountedTimelineDescendants < budgets.maxMountedTimelineDescendants;
  }

  await page.evaluate(() => {
    const elements = window.__playerStore?.getState().elements;
    window.__timelineBenchmarkPreviousElements = elements ? new WeakRef(elements) : null;
    window.__timelineBenchmarkPreviousElement = elements?.at(-1)
      ? new WeakRef(elements.at(-1))
      : null;
  });
  await loadFixtureAndWait(page, 1_000, PROFILE);
  // React keeps the previous committed tree as its alternate. A second bounded
  // project snapshot replaces both sides before GC, so this measures retained
  // application resources rather than the renderer's expected one-commit history.
  await loadFixtureAndWait(page, 1_000, PROFILE);
  await client.send("HeapProfiler.collectGarbage");
  const returnedHeapBytes = await collectHeapBytes(client);
  const retainedFixture = await page.evaluate(() => ({
    elements: window.__timelineBenchmarkPreviousElements?.deref() !== undefined,
    element: window.__timelineBenchmarkPreviousElement?.deref() !== undefined,
  }));
  const memoryReturned =
    returnedHeapBytes <= baselineHeapBytes * (1 + budgets.memoryReturnToleranceRatio);
  const passingRuns = runs.filter((run) => run.passed).length;
  const maxTimelineContentWidthPx = Math.max(0, ...runs.map((run) => run.scrollWidth));
  const directScrollGate = {
    safetyEnvelopePx: budgets.directScrollSafetyPx,
    maxTimelineContentWidthPx,
    measuredMaxReliableScrollWidth,
    decision:
      maxTimelineContentWidthPx <= budgets.directScrollSafetyPx &&
      measuredMaxReliableScrollWidth >= maxTimelineContentWidthPx
        ? "approved"
        : "rejected",
  };
  const evidence = {
    environment: {
      browser: version,
      executablePath,
      os: platform(),
      architecture: arch(),
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: TIER === "high-dpr" ? 2 : 1,
      cpuThrottleRate: TIER === "low-resource" ? 4 : 1,
      tier: TIER,
      fixture: summary,
      runProtocol: {
        warmups: budgets.warmupRuns,
        measured: budgets.measuredRuns,
        requiredPassing: budgets.requiredPassingRuns,
      },
    },
    directScrollGate,
    runs,
    aggregate: {
      interactionP95Ms: percentile(
        runs.map((run) => run.interactionP95Ms),
        0.95,
      ),
      frameIntervalP95Ms: percentile(
        runs.map((run) => run.frameIntervalP95Ms),
        0.95,
      ),
      passingRuns,
      baselineHeapBytes,
      returnedHeapBytes,
      memoryReturned,
      retainedFixture,
    },
  };
  console.log(JSON.stringify(evidence, null, 2));
  exitCode =
    directScrollGate.decision === "approved" &&
    passingRuns >= budgets.requiredPassingRuns &&
    memoryReturned
      ? 0
      : 1;
} finally {
  await browser.close();
}
process.exit(exitCode);

async function waitForFixtureRender(page, elementCount) {
  const deadline = Date.now() + 60_000;
  let observed = null;
  while (Date.now() < deadline) {
    observed = await page.evaluate(() => ({
      modelCount: window.__playerStore?.getState().elements.length ?? null,
      renderedCount:
        document
          .querySelector('[aria-label="Timeline"]')
          ?.getAttribute("data-timeline-element-count") ?? null,
    }));
    if (observed.renderedCount === String(elementCount)) {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timeline fixture ${elementCount} did not render: ${JSON.stringify(observed)}`);
}

async function loadFixtureAndWait(page, elementCount, profile) {
  const summary = await page.evaluate(
    ({ count, fixtureProfile }) =>
      window.__studioTest.loadTimelinePerformanceFixture({
        elementCount: count,
        profile: fixtureProfile,
      }),
    { count: elementCount, fixtureProfile: profile },
  );
  await waitForFixtureRender(page, elementCount);
  return summary;
}

async function waitForStudioTestHookSettle(page) {
  await page.evaluate(async () => {
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (;;) {
      const candidate = window.__studioTest;
      await nextFrame();
      await nextFrame();
      if (candidate === window.__studioTest) return;
    }
  });
}
