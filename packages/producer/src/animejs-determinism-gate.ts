// fallow-ignore-file code-duplication complexity
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseFps, type Fps } from "@hyperframes/core";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { compileForRender } from "./services/htmlCompiler.js";
import { closeFileServerSafely, createFileServer } from "./services/fileServer.js";
import { writeCompiledArtifacts } from "./services/render/shared.js";

export const ANIMEJS_DETERMINISM_FIXTURES = [
  "animejs-adapter",
  "animejs-determinism-springs",
  "animejs-determinism-morph",
  "animejs-determinism-drawable",
  "animejs-determinism-split-text",
  "animejs-determinism-nested-sync",
  "animejs-determinism-seeded-stagger",
  "animejs-determinism-backward-seek",
] as const;

type CheckName =
  | "same-frame-repeatability"
  | "random-seek-direct-equivalence"
  | "backward-seek-zero"
  | "bounds-negative"
  | "bounds-past-duration"
  | "page-runtime";

type SnapshotElement = {
  key: string;
  tagName: string;
  textContent: string;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type DeterminismSnapshot = {
  targetCount: number;
  targets: SnapshotElement[];
};

export type FixtureFailure = {
  fixture: string;
  check: CheckName;
  message: string;
  expectedPath?: string;
  actualPath?: string;
  details?: unknown;
};

type FixtureResult = {
  fixture: string;
  failures: FixtureFailure[];
};

export type AnimeJsDeterminismGateOptions = {
  fixtures: readonly string[];
  artifactsDir: string;
  width: number;
  height: number;
  fps: Fps;
  navigationTimeoutMs: number;
  closeTimeoutMs: number;
};

export type AnimeJsDeterminismGateSummary = {
  totalFixtures: number;
  failedFixtures: number;
  failures: FixtureFailure[];
  artifactsDir: string;
};

type PageCapture = {
  snapshot: DeterminismSnapshot | null;
  failures: FixtureFailure[];
};

type RepeatabilityCapture = {
  first: DeterminismSnapshot | null;
  second: DeterminismSnapshot | null;
  failures: FixtureFailure[];
};

type AnimeEngineActivity =
  | {
      checked: true;
      active: boolean;
      reqId: string | number | null;
      hasChildren: boolean;
      paused: boolean | null;
    }
  | {
      checked: false;
      reason: string;
    };

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = resolve(SOURCE_DIR, "../tests");
const SNAPSHOT_SELECTOR = "[data-det-target]";
const FIXTURE_DURATION_SECONDS = 6;
const FPS_NUMBER = 30;
const RANDOM_ORDER_FRAMES = [90, 10, 50, 10] as const;
const DIRECT_COMPARE_FRAME = 42;

const SNAPSHOT_STYLE_PROPERTIES = [
  "opacity",
  "transform",
  "translate",
  "scale",
  "rotate",
  "background-color",
  "color",
  "fill",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
] as const;

const SNAPSHOT_ATTRIBUTES = [
  "id",
  "class",
  "data-det-target",
  "data-char-index",
  "d",
  "points",
  "transform",
  "draw",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "fill",
  "stroke",
  "pathLength",
] as const;

function defaultGateOptions(): AnimeJsDeterminismGateOptions {
  const fpsResult = parseFps(FPS_NUMBER);
  if (!fpsResult.ok) {
    throw new Error(`Invalid anime.js determinism fps: ${fpsResult.reason}`);
  }
  return {
    fixtures: ANIMEJS_DETERMINISM_FIXTURES,
    artifactsDir: resolve(".debug/animejs-determinism-gate"),
    width: 1920,
    height: 1080,
    fps: fpsResult.value,
    navigationTimeoutMs: 60_000,
    closeTimeoutMs: 3_000,
  };
}

function mergeOptions(
  overrides: Partial<AnimeJsDeterminismGateOptions>,
): AnimeJsDeterminismGateOptions {
  const base = defaultGateOptions();
  return {
    ...base,
    ...overrides,
    fixtures: overrides.fixtures ?? base.fixtures,
    fps: overrides.fps ?? base.fps,
  };
}

function parseArgs(argv: string[]): Partial<AnimeJsDeterminismGateOptions> {
  const args = new Map<string, string>();
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token || !token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, "true");
      continue;
    }
    args.set(key, next);
    i += 1;
  }

  const overrides: Partial<AnimeJsDeterminismGateOptions> = {};
  const fixtures = args.get("fixtures");
  if (fixtures) {
    overrides.fixtures = fixtures
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  const artifactsDir = args.get("artifacts-dir");
  if (artifactsDir) {
    overrides.artifactsDir = resolve(artifactsDir);
  }
  const navigationTimeoutMs = Number(args.get("navigation-timeout-ms"));
  if (Number.isFinite(navigationTimeoutMs) && navigationTimeoutMs > 0) {
    overrides.navigationTimeoutMs = navigationTimeoutMs;
  }
  const closeTimeoutMs = Number(args.get("close-timeout-ms"));
  if (Number.isFinite(closeTimeoutMs) && closeTimeoutMs > 0) {
    overrides.closeTimeoutMs = closeTimeoutMs;
  }
  return overrides;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function writeJson(path: string, data: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function stringifySnapshot(snapshot: DeterminismSnapshot): string {
  return JSON.stringify(snapshot);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(
  fixture: string,
  check: CheckName,
  message: string,
  details?: unknown,
): FixtureFailure {
  return { fixture, check, message, details };
}

function mismatchFailure(
  fixture: string,
  check: CheckName,
  expected: DeterminismSnapshot,
  actual: DeterminismSnapshot,
  artifactsDir: string,
): FixtureFailure {
  const expectedPath = join(artifactsDir, fixture, `${check}-expected.json`);
  const actualPath = join(artifactsDir, fixture, `${check}-actual.json`);
  writeJson(expectedPath, expected);
  writeJson(actualPath, actual);
  return {
    fixture,
    check,
    message: "Snapshot mismatch",
    expectedPath,
    actualPath,
  };
}

function assertFixtureIds(fixtures: readonly string[]): void {
  const known = new Set<string>(ANIMEJS_DETERMINISM_FIXTURES);
  const unknown = fixtures.filter((fixture) => !known.has(fixture));
  if (unknown.length > 0) {
    throw new Error(`Unknown anime.js determinism fixture(s): ${unknown.join(", ")}`);
  }
}

function secondsForFrame(frame: number): number {
  return frame / FPS_NUMBER;
}

async function waitForReady(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const hf = Reflect.get(window, "__hf");
      if (!hf || typeof hf !== "object") return false;
      const seek = Reflect.get(hf, "seek");
      const duration = Number(Reflect.get(hf, "duration"));
      return (
        typeof seek === "function" &&
        Number.isFinite(duration) &&
        duration > 0 &&
        Reflect.get(window, "__renderReady") === true
      );
    },
    { timeout: timeoutMs },
  );
  await page.evaluate(() => document.fonts.ready);
}

async function seekPage(page: Page, seconds: number): Promise<void> {
  await page.evaluate((timeSeconds) => {
    const hf = Reflect.get(window, "__hf");
    if (!hf || typeof hf !== "object") {
      throw new Error("window.__hf is not available");
    }
    const seek = Reflect.get(hf, "seek");
    if (typeof seek !== "function") {
      throw new Error("window.__hf.seek is not available");
    }
    Reflect.apply(seek, hf, [timeSeconds]);
  }, seconds);
  await page.evaluate(
    () =>
      new Promise<void>((resolveDone) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolveDone()));
      }),
  );
}

async function captureSnapshot(page: Page): Promise<DeterminismSnapshot> {
  return page.evaluate(
    (selector, styleProperties, attributeNames) => {
      const targets = Array.from(document.querySelectorAll(selector));
      return {
        targetCount: targets.length,
        targets: targets.map((element, index) => {
          const rect = element.getBoundingClientRect();
          const rectX = Number.isFinite(rect.x) ? Math.round(rect.x * 1_000_000) / 1_000_000 : 0;
          const rectY = Number.isFinite(rect.y) ? Math.round(rect.y * 1_000_000) / 1_000_000 : 0;
          const rectWidth = Number.isFinite(rect.width)
            ? Math.round(rect.width * 1_000_000) / 1_000_000
            : 0;
          const rectHeight = Number.isFinite(rect.height)
            ? Math.round(rect.height * 1_000_000) / 1_000_000
            : 0;
          const styles: Record<string, string> = {};
          const computed = window.getComputedStyle(element);
          for (const property of styleProperties) {
            styles[property] = computed.getPropertyValue(property);
          }
          const attributes: Record<string, string> = {};
          for (const name of attributeNames) {
            const value = element.getAttribute(name);
            if (value != null) attributes[name] = value;
          }
          const targetName = element.getAttribute("data-det-target") || "target";
          const id = element.getAttribute("id") || `${targetName}-${index}`;
          const charIndex = element.getAttribute("data-char-index");
          const key = charIndex == null ? id : `${id}-${charIndex}`;
          return {
            key,
            tagName: element.tagName.toLowerCase(),
            textContent: element.textContent || "",
            attributes,
            styles,
            rect: {
              x: rectX,
              y: rectY,
              width: rectWidth,
              height: rectHeight,
            },
          };
        }),
      };
    },
    SNAPSHOT_SELECTOR,
    [...SNAPSHOT_STYLE_PROPERTIES],
    [...SNAPSHOT_ATTRIBUTES],
  );
}

async function readAnimeEngineActivity(page: Page): Promise<AnimeEngineActivity> {
  return page.evaluate(() => {
    const anime = Reflect.get(window, "anime");
    if (!anime || typeof anime !== "object") {
      return { checked: false as const, reason: "window.anime missing" };
    }
    const engine = Reflect.get(anime, "engine");
    if (!engine || typeof engine !== "object") {
      return { checked: false as const, reason: "anime.engine missing or not inspectable" };
    }
    const reqIdValue = Reflect.get(engine, "reqId");
    const reqId =
      typeof reqIdValue === "string" || typeof reqIdValue === "number" ? reqIdValue : null;
    const head = Reflect.get(engine, "_head");
    const pausedValue = Reflect.get(engine, "paused");
    const hasChildren = Boolean(head);
    return {
      checked: true as const,
      active: Boolean(hasChildren || reqId),
      reqId,
      hasChildren,
      paused: typeof pausedValue === "boolean" ? pausedValue : null,
    };
  });
}

async function closePagePromptly(
  fixture: string,
  check: CheckName,
  page: Page,
  timeoutMs: number,
): Promise<FixtureFailure | null> {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeout = new Promise<"timeout">((resolveTimeout) => {
    timeoutId = setTimeout(() => resolveTimeout("timeout"), timeoutMs);
  });
  const close = page
    .close()
    .then(() => "closed" as const)
    .catch((error: unknown) => error);
  const result = await Promise.race([close, timeout]);
  if (timeoutId) clearTimeout(timeoutId);
  if (result === "closed") return null;
  if (result === "timeout") {
    return failure(fixture, check, `page.close() did not resolve within ${timeoutMs}ms`);
  }
  return failure(fixture, check, `page.close() failed: ${errorMessage(result)}`);
}

async function captureAfterSeeks(input: {
  browser: Browser;
  url: string;
  fixture: string;
  check: CheckName;
  seeks: readonly number[];
  options: AnimeJsDeterminismGateOptions;
}): Promise<PageCapture> {
  const failures: FixtureFailure[] = [];
  const runtimeErrors: string[] = [];
  const page = await input.browser.newPage();
  page.on("pageerror", (error) => {
    runtimeErrors.push(errorMessage(error));
  });

  let snapshot: DeterminismSnapshot | null = null;
  try {
    await page.goto(`${input.url}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: input.options.navigationTimeoutMs,
    });
    await waitForReady(page, input.options.navigationTimeoutMs);
    for (const seconds of input.seeks) {
      await seekPage(page, seconds);
    }
    snapshot = await captureSnapshot(page);
    if (snapshot.targetCount === 0) {
      failures.push(
        failure(input.fixture, input.check, `No elements matched ${SNAPSHOT_SELECTOR}`),
      );
    }
    if (runtimeErrors.length > 0) {
      failures.push(
        failure(input.fixture, input.check, "Page emitted runtime errors", {
          errors: runtimeErrors,
        }),
      );
    }

    const animeActivity = await readAnimeEngineActivity(page);
    if (animeActivity.checked && animeActivity.active) {
      failures.push(
        failure(input.fixture, "page-runtime", "Anime.js engine still has active work", {
          sourceCheck: input.check,
          animeActivity,
        }),
      );
    }
  } catch (error) {
    failures.push(failure(input.fixture, input.check, errorMessage(error)));
  }

  if (!page.isClosed()) {
    const closeFailure = await closePagePromptly(
      input.fixture,
      "page-runtime",
      page,
      input.options.closeTimeoutMs,
    );
    if (closeFailure) failures.push(closeFailure);
  }

  return { snapshot, failures };
}

async function captureSamePageRepeatability(input: {
  browser: Browser;
  url: string;
  fixture: string;
  options: AnimeJsDeterminismGateOptions;
}): Promise<RepeatabilityCapture> {
  const failures: FixtureFailure[] = [];
  const runtimeErrors: string[] = [];
  const page = await input.browser.newPage();
  page.on("pageerror", (error) => {
    runtimeErrors.push(errorMessage(error));
  });

  let first: DeterminismSnapshot | null = null;
  let second: DeterminismSnapshot | null = null;
  try {
    await page.goto(`${input.url}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: input.options.navigationTimeoutMs,
    });
    await waitForReady(page, input.options.navigationTimeoutMs);
    await seekPage(page, 2.35);
    first = await captureSnapshot(page);
    await seekPage(page, 2.35);
    second = await captureSnapshot(page);
    if (first.targetCount === 0 || second.targetCount === 0) {
      failures.push(
        failure(
          input.fixture,
          "same-frame-repeatability",
          `No elements matched ${SNAPSHOT_SELECTOR}`,
        ),
      );
    }
    if (runtimeErrors.length > 0) {
      failures.push(
        failure(input.fixture, "same-frame-repeatability", "Page emitted runtime errors", {
          errors: runtimeErrors,
        }),
      );
    }

    const animeActivity = await readAnimeEngineActivity(page);
    if (animeActivity.checked && animeActivity.active) {
      failures.push(
        failure(input.fixture, "page-runtime", "Anime.js engine still has active work", {
          sourceCheck: "same-frame-repeatability",
          animeActivity,
        }),
      );
    }
  } catch (error) {
    failures.push(failure(input.fixture, "same-frame-repeatability", errorMessage(error)));
  }

  if (!page.isClosed()) {
    const closeFailure = await closePagePromptly(
      input.fixture,
      "page-runtime",
      page,
      input.options.closeTimeoutMs,
    );
    if (closeFailure) failures.push(closeFailure);
  }

  return { first, second, failures };
}

function compareSnapshots(input: {
  fixture: string;
  check: CheckName;
  expected: DeterminismSnapshot | null;
  actual: DeterminismSnapshot | null;
  artifactsDir: string;
}): FixtureFailure | null {
  if (!input.expected || !input.actual) {
    return failure(input.fixture, input.check, "Missing snapshot for comparison");
  }
  if (stringifySnapshot(input.expected) === stringifySnapshot(input.actual)) {
    return null;
  }
  return mismatchFailure(
    input.fixture,
    input.check,
    input.expected,
    input.actual,
    input.artifactsDir,
  );
}

async function compileAndServeFixture(
  fixture: string,
  options: AnimeJsDeterminismGateOptions,
): Promise<{
  serverUrl: string;
  cleanup: () => void;
}> {
  const fixtureDir = join(TESTS_DIR, fixture);
  const srcDir = join(fixtureDir, "src");
  const inputHtmlPath = join(srcDir, "index.html");
  if (!existsSync(inputHtmlPath)) {
    throw new Error(`Fixture is missing src/index.html: ${inputHtmlPath}`);
  }

  const workDir = mkdtempSync(join(tmpdir(), `hf-animejs-determinism-${fixture}-`));
  const downloadDir = join(workDir, "downloads");
  const compiled = await compileForRender(srcDir, inputHtmlPath, downloadDir);
  writeCompiledArtifacts(compiled, workDir, false);
  const compiledDir = join(workDir, "compiled");
  const fileServer = await createFileServer({
    projectDir: srcDir,
    compiledDir,
    fps: options.fps,
  });

  return {
    serverUrl: fileServer.url,
    cleanup: () => {
      closeFileServerSafely(fileServer, "animejs-determinism-gate");
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}

async function runFixture(
  browser: Browser,
  fixture: string,
  options: AnimeJsDeterminismGateOptions,
): Promise<FixtureResult> {
  const failures: FixtureFailure[] = [];
  let servedFixture: Awaited<ReturnType<typeof compileAndServeFixture>> | null = null;
  try {
    servedFixture = await compileAndServeFixture(fixture, options);

    const repeatability = await captureSamePageRepeatability({
      browser,
      url: servedFixture.serverUrl,
      fixture,
      options,
    });
    failures.push(...repeatability.failures);
    const repeatFailure = compareSnapshots({
      fixture,
      check: "same-frame-repeatability",
      expected: repeatability.first,
      actual: repeatability.second,
      artifactsDir: options.artifactsDir,
    });
    if (repeatFailure) failures.push(repeatFailure);

    const randomThenDirect = await captureAfterSeeks({
      browser,
      url: servedFixture.serverUrl,
      fixture,
      check: "random-seek-direct-equivalence",
      seeks: [...RANDOM_ORDER_FRAMES.map(secondsForFrame), secondsForFrame(DIRECT_COMPARE_FRAME)],
      options,
    });
    failures.push(...randomThenDirect.failures);
    const direct = await captureAfterSeeks({
      browser,
      url: servedFixture.serverUrl,
      fixture,
      check: "random-seek-direct-equivalence",
      seeks: [secondsForFrame(DIRECT_COMPARE_FRAME)],
      options,
    });
    failures.push(...direct.failures);
    const randomFailure = compareSnapshots({
      fixture,
      check: "random-seek-direct-equivalence",
      expected: direct.snapshot,
      actual: randomThenDirect.snapshot,
      artifactsDir: options.artifactsDir,
    });
    if (randomFailure) failures.push(randomFailure);

    const backward = await captureAfterSeeks({
      browser,
      url: servedFixture.serverUrl,
      fixture,
      check: "backward-seek-zero",
      seeks: [4.4, 0],
      options,
    });
    failures.push(...backward.failures);
    const initial = await captureAfterSeeks({
      browser,
      url: servedFixture.serverUrl,
      fixture,
      check: "backward-seek-zero",
      seeks: [0],
      options,
    });
    failures.push(...initial.failures);
    const backwardFailure = compareSnapshots({
      fixture,
      check: "backward-seek-zero",
      expected: initial.snapshot,
      actual: backward.snapshot,
      artifactsDir: options.artifactsDir,
    });
    if (backwardFailure) failures.push(backwardFailure);

    const negative = await captureAfterSeeks({
      browser,
      url: servedFixture.serverUrl,
      fixture,
      check: "bounds-negative",
      seeks: [-1],
      options,
    });
    failures.push(...negative.failures);
    const zero = await captureAfterSeeks({
      browser,
      url: servedFixture.serverUrl,
      fixture,
      check: "bounds-negative",
      seeks: [0],
      options,
    });
    failures.push(...zero.failures);
    const negativeFailure = compareSnapshots({
      fixture,
      check: "bounds-negative",
      expected: zero.snapshot,
      actual: negative.snapshot,
      artifactsDir: options.artifactsDir,
    });
    if (negativeFailure) failures.push(negativeFailure);

    const pastDuration = await captureAfterSeeks({
      browser,
      url: servedFixture.serverUrl,
      fixture,
      check: "bounds-past-duration",
      seeks: [FIXTURE_DURATION_SECONDS + 2],
      options,
    });
    failures.push(...pastDuration.failures);
    const durationEnd = await captureAfterSeeks({
      browser,
      url: servedFixture.serverUrl,
      fixture,
      check: "bounds-past-duration",
      seeks: [FIXTURE_DURATION_SECONDS],
      options,
    });
    failures.push(...durationEnd.failures);
    const pastDurationFailure = compareSnapshots({
      fixture,
      check: "bounds-past-duration",
      expected: durationEnd.snapshot,
      actual: pastDuration.snapshot,
      artifactsDir: options.artifactsDir,
    });
    if (pastDurationFailure) failures.push(pastDurationFailure);
  } catch (error) {
    failures.push(failure(fixture, "page-runtime", errorMessage(error)));
  } finally {
    servedFixture?.cleanup();
  }

  const result = { fixture, failures };
  console.log(
    JSON.stringify({
      event: "animejs_determinism_fixture_result",
      fixture,
      passed: failures.length === 0,
      failureCount: failures.length,
    }),
  );
  return result;
}

function createBrowserLaunchOptions(options: AnimeJsDeterminismGateOptions) {
  const browserTarget = process.env.PUPPETEER_EXECUTABLE_PATH
    ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
    : { channel: "chrome" as const };
  return {
    ...browserTarget,
    headless: true,
    defaultViewport: {
      width: options.width,
      height: options.height,
      deviceScaleFactor: 1,
    },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--font-render-hinting=none",
      "--force-color-profile=srgb",
      `--window-size=${options.width},${options.height}`,
    ],
  };
}

export async function runAnimeJsDeterminismGate(
  overrides: Partial<AnimeJsDeterminismGateOptions> = {},
): Promise<AnimeJsDeterminismGateSummary> {
  const options = mergeOptions(overrides);
  assertFixtureIds(options.fixtures);
  ensureDir(options.artifactsDir);
  console.log(
    JSON.stringify({
      event: "animejs_determinism_gate_start",
      fixtures: options.fixtures,
      artifactsDir: options.artifactsDir,
    }),
  );

  const browser = await puppeteer.launch(createBrowserLaunchOptions(options));
  const results: FixtureResult[] = [];
  try {
    for (const fixture of options.fixtures) {
      results.push(await runFixture(browser, fixture, options));
    }
  } finally {
    await browser.close();
  }

  const failures = results.flatMap((result) => result.failures);
  const failedFixtures = results.filter((result) => result.failures.length > 0).length;
  const summary = {
    totalFixtures: results.length,
    failedFixtures,
    failures,
    artifactsDir: options.artifactsDir,
  };
  writeJson(join(options.artifactsDir, "summary.json"), summary);
  console.log(JSON.stringify({ event: "animejs_determinism_gate_summary", ...summary }));
  return summary;
}

async function runCli(): Promise<void> {
  const summary = await runAnimeJsDeterminismGate(parseArgs(process.argv));
  if (summary.failures.length > 0) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  void runCli().catch((error) => {
    console.error(
      JSON.stringify({
        event: "animejs_determinism_gate_fatal",
        message: errorMessage(error),
      }),
    );
    process.exitCode = 1;
  });
}
