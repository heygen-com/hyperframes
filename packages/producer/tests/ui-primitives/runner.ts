import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type CDPSession, type Page } from "puppeteer";
import {
  collectCanonicalEvidence,
  collectReducedMotionEvidence,
  collectSemanticStateEvidence,
  collectThemeLayout,
  collectTimelineEvidence,
  elementScreenshotHash,
  injectAxe,
  loadFixture,
  screenshotHash,
  seekTimeline,
} from "./browser-evidence.js";
import {
  CLOSED_STATE_FIXTURES,
  createDemoFixture,
  createSemanticStateFixture,
  createStandaloneFixture,
  extractCanonicalRegion,
  type OperatorBlackTheme,
} from "./semantic-fixtures.js";
import {
  auditCanonicalParity,
  auditPresentation,
  auditSemanticSnapshot,
  auditSemanticStateSnapshot,
  auditTargetGeometry,
  auditThemeLayoutParity,
  auditTimelineSnapshot,
  buildVerificationSummary,
  compareFrameHashPasses,
  parseArgs,
  validateVerificationModel,
  type VerificationFailure,
} from "./verify.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const scopePath = resolve(repoRoot, "registry/ui-primitives/operator-black.scope.json");
const statesPath = resolve(repoRoot, "registry/ui-primitives/operator-black.states.json");
const checkpointsPath = resolve(here, "frame-checkpoints.json");
const frameHashesPath = resolve(here, "frame-hashes.json");
const imageLockPath = resolve(repoRoot, "registry/ui-primitives/visual-test-image.lock.json");
const gsapPath = resolve(repoRoot, "registry/ui-primitives/vendor/gsap-3.14.2.min.js");
const mediaSessions = new WeakMap<Page, CDPSession>();

export const THEMES: readonly OperatorBlackTheme[] = ["dark", "light"];
export interface ViewportSpec {
  name: string;
  width: number;
  height: number;
  axe: boolean;
  allowVerticalScroll: boolean;
}

export const VIEWPORTS = [
  { name: "compact-280", width: 280, height: 653, axe: false, allowVerticalScroll: false },
  { name: "mobile-360", width: 360, height: 800, axe: false, allowVerticalScroll: false },
  { name: "small-640", width: 640, height: 960, axe: true, allowVerticalScroll: false },
  { name: "tablet-1024", width: 1024, height: 768, axe: false, allowVerticalScroll: false },
  { name: "desktop-1920", width: 1920, height: 1080, axe: false, allowVerticalScroll: false },
  { name: "short-640", width: 640, height: 360, axe: false, allowVerticalScroll: true },
] as const satisfies readonly ViewportSpec[];

export const REFLOW_PROFILES = [
  {
    name: "zoom-200",
    zoom: 2,
    baseWidth: 1280,
    width: 640,
    height: 900,
    axe: false,
    allowVerticalScroll: true,
  },
  {
    name: "zoom-400",
    zoom: 4,
    baseWidth: 1280,
    width: 320,
    height: 900,
    axe: false,
    allowVerticalScroll: true,
  },
] as const;

export const FORCED_COLORS_VIEWPORT = {
  name: "forced-colors-360",
  width: 360,
  height: 800,
  axe: false,
  allowVerticalScroll: true,
} as const satisfies ViewportSpec;

const DETERMINISM_VIEWPORT = {
  name: "desktop-1440",
  width: 1440,
  height: 900,
  axe: false,
  allowVerticalScroll: false,
} as const satisfies ViewportSpec;

interface StateItem {
  id: string;
  focusTarget: string;
  renderCheckpoints: string[];
  staticStates?: string[];
}

interface ScopeModel {
  version: number;
  name: string;
  items: string[];
}

interface StatesModel {
  version: number;
  name: string;
  items: StateItem[];
}

interface CheckpointModel {
  version: number;
  selection: string;
  sequentialPasses: number;
  shuffledPasses: number;
  includeMidpoint: boolean;
  includeFinalFrame: boolean;
  fps: number;
  theme: string;
  viewport: string;
}

interface ImageLock {
  container: {
    image: string;
    digest: string;
  };
  puppeteer: string;
  chromeForTesting: string;
  gsap: {
    path: string;
    version: string;
    sha256: string;
  };
  environment: {
    deviceScaleFactor: number;
    locale: string;
    timezone: string;
  };
}

interface SourcePair {
  canonical: string;
  demo: string;
  demoCanonical: string;
}

export interface RuntimeRecorder {
  reset: () => void;
  consoleErrors: string[];
  pageErrors: string[];
  remoteRequests: string[];
}

type FailureContext = Omit<VerificationFailure, "category" | "message">;

export function drainRuntimeFailures(
  runtime: RuntimeRecorder,
  context: FailureContext,
  passName?: string,
): VerificationFailure[] {
  const prefix = passName === undefined ? "" : `${passName}: `;
  const failures: VerificationFailure[] = [
    ...runtime.consoleErrors.map((entry) => ({
      ...context,
      category: "runtime.console",
      message: `${prefix}${entry}`,
    })),
    ...runtime.pageErrors.map((entry) => ({
      ...context,
      category: "runtime.page",
      message: `${prefix}${entry}`,
    })),
    ...runtime.remoteRequests.map((entry) => ({
      ...context,
      category: "runtime.network",
      message: `${prefix}${entry}`,
    })),
  ];
  runtime.reset();
  return failures;
}

interface BrowserEnvironment {
  container: {
    image: string;
    digest: string;
    verified: boolean;
  };
  puppeteer: string;
  chromeForTesting: string;
  browser: string;
  gsap: {
    path: string;
    version: string;
    sha256: string;
  };
  deviceScaleFactor: number;
  locale: string;
  timezone: string;
  platform: string;
  architecture: string;
  osRelease: string;
  fontFingerprint: string;
}

export interface FrameHashArtifact {
  version: 1;
  environment: BrowserEnvironment;
  frames: Record<string, string>;
}

interface RunReport {
  version: 1;
  environment: BrowserEnvironment;
  summary: ReturnType<typeof buildVerificationSummary>;
  failures: VerificationFailure[];
  hashes: {
    expected: number;
    passes: FrameHashPass[];
    matching: boolean;
    published: boolean;
  };
}

export interface CapturePoint {
  key: string;
  position: string | number;
}

export interface PassSpec {
  name: string;
  order: "sequential" | "shuffled";
}

export interface FrameHashPass extends PassSpec {
  frames: Record<string, string>;
}

export interface VisualLockEvidence {
  containerImage: string | null;
  containerDigest: string | null;
  puppeteer: string;
  chromeForTesting: string;
  gsapPath: string;
  gsapVersion: string;
  gsapSha256: string;
  deviceScaleFactor: number;
  locale: string;
  timezone: string;
}

type CanonicalPlanItem = {
  id: string;
  focusTarget: string;
  theme: OperatorBlackTheme;
  viewport: ViewportSpec;
};

type FocusPlanItem = {
  id: string;
  focusTarget: string;
  theme: OperatorBlackTheme;
  viewport: ViewportSpec;
  forcedColors: boolean;
};

export function buildRunPlan(items: readonly StateItem[]): {
  canonical: CanonicalPlanItem[];
  demos: readonly StateItem[];
} {
  const canonical: CanonicalPlanItem[] = [];
  for (const item of items) {
    for (const theme of THEMES) {
      for (const viewport of VIEWPORTS) {
        canonical.push({
          id: item.id,
          focusTarget: item.focusTarget,
          theme,
          viewport,
        });
      }
    }
  }
  return { canonical, demos: items };
}

export function buildFocusRunPlan(items: readonly StateItem[]): FocusPlanItem[] {
  const focusable = items.filter((item) => item.focusTarget !== "none");
  return focusable.flatMap((item) => [
    ...THEMES.flatMap((theme) =>
      REFLOW_PROFILES.map((viewport) => ({
        id: item.id,
        focusTarget: item.focusTarget,
        theme,
        viewport,
        forcedColors: false,
      })),
    ),
    {
      id: item.id,
      focusTarget: item.focusTarget,
      theme: "dark" as const,
      viewport: FORCED_COLORS_VIEWPORT,
      forcedColors: true,
    },
  ]);
}

export function buildCapturePoints(
  item: StateItem,
  timing: { duration: number; fps: number },
): CapturePoint[] {
  if (!Number.isFinite(timing.duration) || timing.duration <= 0) {
    throw new Error(`${item.id} must declare a positive finite duration`);
  }
  if (!Number.isFinite(timing.fps) || timing.fps <= 0) {
    throw new Error(`${item.id} must declare a positive finite fps`);
  }
  const frameCount = Math.max(1, Math.ceil(timing.duration * timing.fps));
  return [
    ...item.renderCheckpoints.map((checkpoint) => ({
      key: checkpoint,
      position: checkpoint,
    })),
    { key: "@midpoint", position: Math.floor((frameCount - 1) / 2) / timing.fps },
    { key: "@final-frame", position: (frameCount - 1) / timing.fps },
  ];
}

export function buildPassSpecs(sequentialPasses: number, shuffledPasses: number): PassSpec[] {
  return [
    ...Array.from({ length: sequentialPasses }, (_, index) => ({
      name: `sequential-${index + 1}`,
      order: "sequential" as const,
    })),
    ...Array.from({ length: shuffledPasses }, (_, index) => ({
      name: `shuffled-${index + 1}`,
      order: "shuffled" as const,
    })),
  ];
}

export function orderCapturePoints(
  points: readonly CapturePoint[],
  order: PassSpec["order"],
  seedSource = "operator-black",
): CapturePoint[] {
  if (order === "sequential" || points.length <= 1) return [...points];
  let seed = 2166136261;
  for (const character of seedSource) {
    seed ^= character.codePointAt(0) ?? 0;
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  const shuffled = [...points];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const swapIndex = seed % (index + 1);
    const current = shuffled[index];
    const swap = shuffled[swapIndex];
    if (current === undefined || swap === undefined) continue;
    shuffled[index] = swap;
    shuffled[swapIndex] = current;
  }
  if (shuffled.every((point, index) => point === points[index])) {
    const first = shuffled.shift();
    if (first !== undefined) shuffled.push(first);
  }
  return shuffled;
}

function sameExactKeys(expectedKeys: string[], values: Record<string, string>): boolean {
  if (new Set(expectedKeys).size !== expectedKeys.length) return false;
  const actualKeys = Object.keys(values);
  if (actualKeys.length !== expectedKeys.length) return false;
  const actual = new Set(actualKeys);
  return expectedKeys.every((key) => actual.has(key));
}

export function buildFrameHashArtifact(
  environment: BrowserEnvironment,
  expectedKeys: string[],
  passes: FrameHashPass[],
  failures: VerificationFailure[],
): FrameHashArtifact | null {
  if (failures.length > 0) return null;
  if (passes.length !== 4 || passes.some((pass) => !sameExactKeys(expectedKeys, pass.frames))) {
    return null;
  }
  const baseline = passes[0]?.frames;
  if (
    baseline === undefined ||
    passes.slice(1).some((pass) => compareFrameHashPasses(baseline, pass.frames).length > 0)
  ) {
    return null;
  }
  const frames = Object.fromEntries(expectedKeys.map((key) => [key, baseline[key] ?? ""]));
  return { version: 1, environment, frames };
}

export function auditFrameHashLock(
  expected: unknown,
  candidate: FrameHashArtifact,
): VerificationFailure[] {
  if (!isRecord(expected) || expected.version !== 1) {
    return [
      {
        category: "determinism.lock-invalid",
        message: "committed frame-hashes.json must be a version 1 object",
      },
    ];
  }
  if (!isRecord(expected.environment) || !isRecord(expected.frames)) {
    return [
      {
        category: "determinism.lock-invalid",
        message: "committed frame-hashes.json must contain environment and frames",
      },
    ];
  }
  const failures: VerificationFailure[] = [];
  const stableEnvironment = (value: unknown): unknown => {
    const environment = isRecord(value) ? value : {};
    const container = isRecord(environment.container) ? environment.container : {};
    const gsap = isRecord(environment.gsap) ? environment.gsap : {};
    return {
      container: { image: container.image, digest: container.digest },
      puppeteer: environment.puppeteer,
      chromeForTesting: environment.chromeForTesting,
      gsap: {
        path: gsap.path,
        version: gsap.version,
        sha256: gsap.sha256,
      },
      deviceScaleFactor: environment.deviceScaleFactor,
      locale: environment.locale,
      timezone: environment.timezone,
      platform: environment.platform,
      architecture: environment.architecture,
      fontFingerprint: environment.fontFingerprint,
    };
  };
  if (
    JSON.stringify(stableEnvironment(expected.environment)) !==
    JSON.stringify(stableEnvironment(candidate.environment))
  ) {
    failures.push({
      category: "determinism.lock-environment",
      message: "committed frame hash environment differs from the locked browser environment",
    });
  }
  const expectedFrames: Record<string, string> = {};
  for (const [key, value] of Object.entries(expected.frames)) {
    if (typeof value !== "string") {
      failures.push({
        category: "determinism.lock-invalid",
        message: `committed frame hash ${key} must be a string`,
      });
      continue;
    }
    expectedFrames[key] = value;
  }
  failures.push(
    ...compareFrameHashPasses(expectedFrames, candidate.frames).map((entry) => ({
      ...entry,
      category: `determinism.lock-${entry.category.replace("determinism.", "")}`,
    })),
  );
  return failures;
}

export function validateVisualLock(
  lock: ImageLock,
  evidence: VisualLockEvidence,
  requireContainer: boolean,
): VerificationFailure[] {
  const failures: VerificationFailure[] = [];
  const compare = (
    category: string,
    expected: string | number,
    actual: string | number | null,
  ): void => {
    if (actual === expected) return;
    failures.push({ category, message: `expected ${expected}, found ${actual ?? "unverified"}` });
  };
  if (requireContainer || evidence.containerImage !== null) {
    compare("environment.container-image", lock.container.image, evidence.containerImage);
  }
  if (requireContainer || evidence.containerDigest !== null) {
    compare("environment.container-digest", lock.container.digest, evidence.containerDigest);
  }
  compare("environment.puppeteer-version", lock.puppeteer, evidence.puppeteer);
  compare("environment.chrome-version", lock.chromeForTesting, evidence.chromeForTesting);
  compare("environment.gsap-path", lock.gsap.path, evidence.gsapPath);
  compare("environment.gsap-version", lock.gsap.version, evidence.gsapVersion);
  compare("environment.gsap-sha256", lock.gsap.sha256, evidence.gsapSha256);
  compare(
    "environment.device-scale-factor",
    lock.environment.deviceScaleFactor,
    evidence.deviceScaleFactor,
  );
  compare("environment.locale", lock.environment.locale, evidence.locale);
  compare("environment.timezone", lock.environment.timezone, evidence.timezone);
  return failures;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringProperty(record: Record<string, unknown>, key: string, source: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`${source}.${key} must be a string`);
  return value;
}

function numberProperty(record: Record<string, unknown>, key: string, source: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${source}.${key} must be a finite number`);
  }
  return value;
}

function booleanProperty(record: Record<string, unknown>, key: string, source: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new Error(`${source}.${key} must be a boolean`);
  return value;
}

function stringArray(value: unknown, source: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${source} must be an array of strings`);
  }
  return [...value];
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseScope(value: unknown): ScopeModel {
  if (!isRecord(value)) throw new Error("scope must be an object");
  return {
    version: numberProperty(value, "version", "scope"),
    name: stringProperty(value, "name", "scope"),
    items: stringArray(value.items, "scope.items"),
  };
}

function parseStates(value: unknown): StatesModel {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("states must be an object with items");
  }
  const items = value.items.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`states.items[${index}] must be an object`);
    return {
      id: stringProperty(entry, "id", `states.items[${index}]`),
      focusTarget: stringProperty(entry, "focusTarget", `states.items[${index}]`),
      staticStates: stringArray(entry.staticStates, `states.items[${index}].staticStates`),
      renderCheckpoints: stringArray(
        entry.renderCheckpoints,
        `states.items[${index}].renderCheckpoints`,
      ),
    };
  });
  return {
    version: numberProperty(value, "version", "states"),
    name: stringProperty(value, "name", "states"),
    items,
  };
}

function parseCheckpoints(value: unknown): CheckpointModel {
  if (!isRecord(value)) throw new Error("frame checkpoints must be an object");
  return {
    version: numberProperty(value, "version", "frameCheckpoints"),
    selection: stringProperty(value, "selection", "frameCheckpoints"),
    sequentialPasses: numberProperty(value, "sequentialPasses", "frameCheckpoints"),
    shuffledPasses: numberProperty(value, "shuffledPasses", "frameCheckpoints"),
    includeMidpoint: booleanProperty(value, "includeMidpoint", "frameCheckpoints"),
    includeFinalFrame: booleanProperty(value, "includeFinalFrame", "frameCheckpoints"),
    fps: numberProperty(value, "fps", "frameCheckpoints"),
    theme: stringProperty(value, "theme", "frameCheckpoints"),
    viewport: stringProperty(value, "viewport", "frameCheckpoints"),
  };
}

function parseImageLock(value: unknown): ImageLock {
  if (
    !isRecord(value) ||
    !isRecord(value.container) ||
    !isRecord(value.gsap) ||
    !isRecord(value.environment)
  ) {
    throw new Error("visual test image lock must declare container, GSAP, and environment");
  }
  return {
    container: {
      image: stringProperty(value.container, "image", "imageLock.container"),
      digest: stringProperty(value.container, "digest", "imageLock.container"),
    },
    puppeteer: stringProperty(value, "puppeteer", "imageLock"),
    chromeForTesting: stringProperty(value, "chromeForTesting", "imageLock"),
    gsap: {
      path: stringProperty(value.gsap, "path", "imageLock.gsap"),
      version: stringProperty(value.gsap, "version", "imageLock.gsap"),
      sha256: stringProperty(value.gsap, "sha256", "imageLock.gsap"),
    },
    environment: {
      deviceScaleFactor: numberProperty(
        value.environment,
        "deviceScaleFactor",
        "imageLock.environment",
      ),
      locale: stringProperty(value.environment, "locale", "imageLock.environment"),
      timezone: stringProperty(value.environment, "timezone", "imageLock.environment"),
    },
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function contextualize(
  entries: VerificationFailure[],
  context: Omit<VerificationFailure, "category" | "message">,
): VerificationFailure[] {
  return entries.map((entry) => ({ ...entry, ...context }));
}

async function createAuditedPage(browser: Browser): Promise<{
  page: Page;
  runtime: RuntimeRecorder;
}> {
  const page = await browser.newPage();
  const runtime: RuntimeRecorder = {
    consoleErrors: [],
    pageErrors: [],
    remoteRequests: [],
    reset() {
      this.consoleErrors.length = 0;
      this.pageErrors.length = 0;
      this.remoteRequests.length = 0;
    },
  };
  await page.setRequestInterception(true);
  page.on("console", (entry) => {
    if (entry.type() === "error") runtime.consoleErrors.push(entry.text());
  });
  page.on("pageerror", (error) => runtime.pageErrors.push(message(error)));
  page.on("request", (request) => {
    const url = request.url();
    if (/^(?:about:|blob:|data:)/.test(url)) {
      void request.continue().catch(() => undefined);
      return;
    }
    runtime.remoteRequests.push(url);
    void request.abort("blockedbyclient").catch(() => undefined);
  });
  return { page, runtime };
}

export async function emulateVerifierMedia(
  page: Page,
  options: { reducedMotion: boolean; forcedColors: boolean },
): Promise<void> {
  let session = mediaSessions.get(page);
  if (session === undefined) {
    session = await page.createCDPSession();
    mediaSessions.set(page, session);
  }
  await session.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [
      {
        name: "prefers-reduced-motion",
        value: options.reducedMotion ? "reduce" : "no-preference",
      },
      { name: "forced-colors", value: options.forcedColors ? "active" : "none" },
    ],
  });
  const active = await page.evaluate(() => ({
    forcedColors: matchMedia("(forced-colors: active)").matches,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  }));
  if (
    active.forcedColors !== options.forcedColors ||
    active.reducedMotion !== options.reducedMotion
  ) {
    throw new Error(
      `media emulation expected forced-colors=${options.forcedColors} reduced-motion=${options.reducedMotion}`,
    );
  }
}

async function setViewport(
  page: Page,
  viewport: ViewportSpec,
  coarsePointer: boolean,
  forcedColors = false,
): Promise<void> {
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: coarsePointer,
  });
  await emulateVerifierMedia(page, { reducedMotion: false, forcedColors });
}

function sha256(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function gsapVersion(source: string): string {
  const version = /\bGSAP\s+(\d+\.\d+\.\d+)\b/.exec(source)?.[1];
  if (version === undefined) throw new Error("vendored GSAP source has no version banner");
  return version;
}

function parseDemoTiming(source: string, defaultFps: number): { duration: number; fps: number } {
  const composition = /<[^>]+\bdata-composition-id=["'][^"']+["'][^>]*>/is.exec(source)?.[0];
  if (composition === undefined) throw new Error("demo has no composition root");
  const attribute = (name: string): string | undefined =>
    new RegExp(`\\b${name}=["']([^"']+)["']`, "i").exec(composition)?.[1];
  const duration = Number(attribute("data-duration"));
  const fpsSource = attribute("data-fps");
  const fps = fpsSource === undefined ? defaultFps : Number(fpsSource);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`demo has invalid data-duration ${attribute("data-duration") ?? "missing"}`);
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`demo has invalid data-fps ${fpsSource ?? "missing"}`);
  }
  return { duration, fps };
}

async function probeBrowserEnvironment(page: Page): Promise<{
  deviceScaleFactor: number;
  locale: string;
  timezone: string;
  fontFingerprint: string;
}> {
  await setViewport(page, DETERMINISM_VIEWPORT, false);
  await loadFixture(page, '<!doctype html><html lang="en"><body>environment probe</body></html>');
  const probe = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("2D canvas unavailable for font probe");
    const sample = "Operator Black 0123456789 → MmWw";
    const families = ["ui-sans-serif", "ui-monospace", "sans-serif", "monospace"];
    const metrics = families.map((family) => {
      context.font = `16px ${family}`;
      const measurement = context.measureText(sample);
      return {
        family,
        width: measurement.width,
        actualBoundingBoxAscent: measurement.actualBoundingBoxAscent,
        actualBoundingBoxDescent: measurement.actualBoundingBoxDescent,
      };
    });
    return {
      deviceScaleFactor: devicePixelRatio,
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      metrics,
    };
  });
  return {
    deviceScaleFactor: probe.deviceScaleFactor,
    locale: probe.locale,
    timezone: probe.timezone,
    fontFingerprint: sha256(JSON.stringify(probe.metrics)),
  };
}

async function loadSources(
  ids: string[],
  failures: VerificationFailure[],
): Promise<Map<string, SourcePair>> {
  const sources = new Map<string, SourcePair>();
  for (const id of ids) {
    try {
      const componentDir = resolve(repoRoot, "registry/components", id);
      const [canonical, demo] = await Promise.all([
        readFile(resolve(componentDir, `${id}.html`), "utf8"),
        readFile(resolve(componentDir, "demo.html"), "utf8"),
      ]);
      sources.set(id, {
        canonical,
        demo,
        demoCanonical: extractCanonicalRegion(demo),
      });
    } catch (error) {
      failures.push({
        id,
        fixture: "canonical",
        category: "fixture.source",
        message: message(error),
      });
    }
  }
  return sources;
}

async function verifyParity(
  page: Page,
  runtime: RuntimeRecorder,
  items: readonly StateItem[],
  sources: Map<string, SourcePair>,
  failures: VerificationFailure[],
): Promise<number> {
  let checks = 0;
  const viewport = DETERMINISM_VIEWPORT;
  await setViewport(page, viewport, false);
  for (const item of items) {
    const source = sources.get(item.id);
    if (source === undefined) continue;
    for (const theme of THEMES) {
      checks += 2;
      try {
        runtime.reset();
        await loadFixture(page, createStandaloneFixture(source.canonical, { id: item.id, theme }));
        await page.evaluate(() => {
          document.body.dataset.hfRendering = "true";
        });
        const canonicalHash = await elementScreenshotHash(page, "[data-hf-ui-root]");
        await loadFixture(
          page,
          createStandaloneFixture(source.demoCanonical, { id: item.id, theme }),
        );
        await page.evaluate(() => {
          document.body.dataset.hfRendering = "true";
        });
        const demoCanonicalHash = await elementScreenshotHash(page, "[data-hf-ui-root]");
        failures.push(
          ...contextualize(
            auditCanonicalParity({
              canonicalSource: source.canonical,
              demoCanonicalSource: source.demoCanonical,
              canonicalHash,
              demoCanonicalHash,
            }),
            {
              id: item.id,
              fixture: "canonical",
              theme,
              viewport: viewport.name,
            },
          ),
        );
        for (const url of runtime.remoteRequests) {
          failures.push({
            id: item.id,
            fixture: "canonical",
            theme,
            viewport: viewport.name,
            category: "runtime.network",
            message: url,
          });
        }
      } catch (error) {
        failures.push({
          id: item.id,
          fixture: "canonical",
          theme,
          viewport: viewport.name,
          category: "parity.runtime",
          message: message(error),
        });
      }
    }
  }
  return checks;
}

async function verifyCanonicalMatrix(
  page: Page,
  runtime: RuntimeRecorder,
  plan: ReturnType<typeof buildRunPlan>["canonical"],
  sources: Map<string, SourcePair>,
  axeSource: string,
  failures: VerificationFailure[],
): Promise<number> {
  let checks = 0;
  const darkLayouts = new Map<string, Awaited<ReturnType<typeof collectThemeLayout>>>();
  for (const fixture of plan) {
    const source = sources.get(fixture.id);
    if (source === undefined) continue;
    try {
      runtime.reset();
      await setViewport(page, fixture.viewport, true);
      await loadFixture(
        page,
        createStandaloneFixture(source.canonical, {
          id: fixture.id,
          theme: fixture.theme,
        }),
      );
      const themeLayout = await collectThemeLayout(page);
      const layoutKey = `${fixture.id}:${fixture.viewport.name}`;
      if (fixture.theme === "dark") {
        darkLayouts.set(layoutKey, themeLayout);
      } else {
        const darkLayout = darkLayouts.get(layoutKey);
        if (darkLayout === undefined) {
          failures.push({
            id: fixture.id,
            fixture: "canonical",
            theme: fixture.theme,
            viewport: fixture.viewport.name,
            category: "parity.theme-layout-missing",
            message: "dark layout evidence is missing",
          });
        } else {
          failures.push(
            ...contextualize(auditThemeLayoutParity(darkLayout, themeLayout), {
              id: fixture.id,
              fixture: "canonical",
              theme: fixture.theme,
              viewport: fixture.viewport.name,
            }),
          );
        }
        checks += 1;
      }
      if (fixture.viewport.axe) await injectAxe(page, axeSource);
      const evidence = await collectCanonicalEvidence(page, fixture.focusTarget, {
        runAxe: fixture.viewport.axe,
      });
      await emulateVerifierMedia(page, { reducedMotion: true, forcedColors: false });
      evidence.semantics.reducedMotionMoving = await collectReducedMotionEvidence(page);

      const context = {
        id: fixture.id,
        fixture: "canonical" as const,
        theme: fixture.theme,
        viewport: fixture.viewport.name,
      };
      failures.push(
        ...contextualize(
          auditPresentation(evidence.presentation, {
            allowVerticalScroll: fixture.viewport.allowVerticalScroll,
          }),
          context,
        ),
      );
      failures.push(...contextualize(auditTargetGeometry(evidence.targets, true), context));
      failures.push(...contextualize(auditSemanticSnapshot(evidence.semantics), context));
      if (!evidence.coarsePointer) {
        failures.push({
          ...context,
          category: "environment.coarse-pointer",
          message: "coarse-pointer emulation did not activate (pointer: coarse)",
        });
      }
      for (const error of runtime.consoleErrors) {
        failures.push({ ...context, category: "runtime.console", message: error });
      }
      for (const error of runtime.pageErrors) {
        failures.push({ ...context, category: "runtime.page", message: error });
      }
      for (const url of runtime.remoteRequests) {
        failures.push({ ...context, category: "runtime.network", message: url });
      }
      const targetPairs = (evidence.targets.length * (evidence.targets.length - 1)) / 2;
      checks += 13 + evidence.targets.length * 2 + targetPairs;
    } catch (error) {
      failures.push({
        id: fixture.id,
        fixture: "canonical",
        theme: fixture.theme,
        viewport: fixture.viewport.name,
        category: "fixture.runtime",
        message: message(error),
      });
      checks += 1;
    }
  }
  return checks;
}

export function validateClosedStateFixtureCoverage(
  items: readonly StateItem[],
  specs: readonly { id: string }[] = CLOSED_STATE_FIXTURES,
): VerificationFailure[] {
  const declared = items
    .filter((item) => item.staticStates?.includes("closed"))
    .map((item) => item.id)
    .toSorted();
  const fixtureIds = specs.map((spec) => spec.id).toSorted();
  if (
    declared.length === fixtureIds.length &&
    declared.every((id, index) => id === fixtureIds[index])
  ) {
    return [];
  }
  return [
    {
      category: "state.fixture-coverage",
      message: `closed-state fixtures must match inventory: declared=${declared.join(",")} fixtures=${fixtureIds.join(",")}`,
    },
  ];
}

async function verifyFocusModes(
  page: Page,
  runtime: RuntimeRecorder,
  plan: readonly FocusPlanItem[],
  sources: Map<string, SourcePair>,
  failures: VerificationFailure[],
): Promise<number> {
  let checks = 0;
  for (const fixture of plan) {
    const source = sources.get(fixture.id);
    if (source === undefined) continue;
    const context = {
      id: fixture.id,
      fixture: "canonical" as const,
      theme: fixture.theme,
      viewport: fixture.viewport.name,
    };
    try {
      runtime.reset();
      await setViewport(page, fixture.viewport, false, fixture.forcedColors);
      await loadFixture(
        page,
        createStandaloneFixture(source.canonical, {
          id: fixture.id,
          theme: fixture.theme,
        }),
      );
      const evidence = await collectCanonicalEvidence(page, fixture.focusTarget, {
        runAxe: false,
      });
      failures.push(
        ...contextualize(
          auditPresentation(evidence.presentation, { allowVerticalScroll: true }),
          context,
        ),
      );
      failures.push(...contextualize(auditSemanticSnapshot(evidence.semantics), context));
      for (const error of runtime.consoleErrors) {
        failures.push({ ...context, category: "runtime.console", message: error });
      }
      for (const error of runtime.pageErrors) {
        failures.push({ ...context, category: "runtime.page", message: error });
      }
      for (const url of runtime.remoteRequests) {
        failures.push({ ...context, category: "runtime.network", message: url });
      }
      checks += 10;
    } catch (error) {
      failures.push({
        ...context,
        category: fixture.forcedColors ? "forced-colors.runtime" : "reflow.runtime",
        message: message(error),
      });
      checks += 1;
    }
  }
  return checks;
}

async function verifySemanticStates(
  page: Page,
  runtime: RuntimeRecorder,
  selectedIds: ReadonlySet<string>,
  sources: Map<string, SourcePair>,
  axeSource: string,
  failures: VerificationFailure[],
): Promise<number> {
  let checks = 0;
  const viewport = VIEWPORTS.find((candidate) => candidate.name === "small-640");
  if (viewport === undefined) throw new Error("semantic viewport small-640 is missing");
  for (const spec of CLOSED_STATE_FIXTURES) {
    if (!selectedIds.has(spec.id)) continue;
    const source = sources.get(spec.id);
    if (source === undefined) continue;
    for (const state of ["open", "closed"] as const) {
      const context = {
        id: spec.id,
        fixture: "canonical" as const,
        theme: "dark" as const,
        viewport: "semantic-state",
        checkpoint: state,
      };
      try {
        runtime.reset();
        await setViewport(page, viewport, false);
        await loadFixture(
          page,
          createSemanticStateFixture(source.canonical, {
            id: spec.id,
            theme: "dark",
            spec,
            state,
          }),
        );
        await injectAxe(page, axeSource);
        const evidence = await collectSemanticStateEvidence(page, spec, state);
        failures.push(...contextualize(auditSemanticStateSnapshot(evidence), context));
        for (const error of runtime.consoleErrors) {
          failures.push({ ...context, category: "runtime.console", message: error });
        }
        for (const error of runtime.pageErrors) {
          failures.push({ ...context, category: "runtime.page", message: error });
        }
        for (const url of runtime.remoteRequests) {
          failures.push({ ...context, category: "runtime.network", message: url });
        }
        checks += 12;
      } catch (error) {
        failures.push({
          ...context,
          category: "state.fixture-runtime",
          message: message(error),
        });
        checks += 1;
      }
    }
  }
  return checks;
}

async function verifyRegistration(page: Page, id: string): Promise<VerificationFailure[]> {
  const snapshot = await page.evaluate((expectedKey) => {
    const keys = Object.keys(window.__timelines ?? {});
    const rendering =
      document.querySelector<HTMLElement>("[data-composition-id]")?.dataset.hfRendering;
    return { keys, rendering, expectedKey };
  }, `${id}-demo`);
  const failures: VerificationFailure[] = [];
  if (snapshot.keys.length !== 1 || snapshot.keys[0] !== snapshot.expectedKey) {
    failures.push({
      category: "timeline.registration",
      message: `expected only ${snapshot.expectedKey}, found ${snapshot.keys.join(", ") || "none"}`,
    });
  }
  if (snapshot.rendering !== "true") {
    failures.push({
      category: "motion.render-mode",
      message: "demo must set data-hf-rendering=true",
    });
  }
  return failures;
}

async function captureDemoPass(
  page: Page,
  runtime: RuntimeRecorder,
  items: readonly StateItem[],
  sources: Map<string, SourcePair>,
  gsapSource: string,
  checkpointModel: CheckpointModel,
  pass: PassSpec,
  failures: VerificationFailure[],
  audit: boolean,
): Promise<{ checks: number; pass: FrameHashPass }> {
  const hashes: Record<string, string> = {};
  let checks = 0;
  const viewport = DETERMINISM_VIEWPORT;
  await setViewport(page, viewport, false);
  const orderedItems = pass.order === "shuffled" ? items.toReversed() : items;
  for (const item of orderedItems) {
    const source = sources.get(item.id);
    if (source === undefined) continue;
    const context = {
      id: item.id,
      fixture: "demo" as const,
      theme: "dark" as const,
      viewport: viewport.name,
    };
    try {
      runtime.reset();
      const fixture = createDemoFixture(source.demo, {
        id: item.id,
        theme: "dark",
        gsapSource,
      });
      const points = orderCapturePoints(
        buildCapturePoints(item, parseDemoTiming(source.demo, checkpointModel.fps)),
        pass.order,
        item.id,
      );
      await loadFixture(page, fixture);
      if (audit) {
        failures.push(...contextualize(await verifyRegistration(page, item.id), context));
        const renderModeMovement = await collectReducedMotionEvidence(page);
        for (const movement of renderModeMovement) {
          failures.push({
            ...context,
            category: "motion.render-css",
            message: movement,
          });
        }
        const timeline = await collectTimelineEvidence(page, item.renderCheckpoints);
        timeline.consoleErrors = [...runtime.consoleErrors];
        timeline.pageErrors = [...runtime.pageErrors];
        failures.push(...contextualize(auditTimelineSnapshot(timeline), context));
        for (const url of runtime.remoteRequests) {
          failures.push({ ...context, category: "runtime.network", message: url });
        }
        checks += item.renderCheckpoints.length + 6;
        runtime.reset();
        await loadFixture(page, fixture);
      }
      for (const point of points) {
        try {
          await seekTimeline(page, point.position);
          hashes[`${item.id}:${point.key}`] = await screenshotHash(page);
          checks += 1;
        } catch (error) {
          failures.push({
            ...context,
            checkpoint: point.key,
            category: "timeline.seek",
            message: message(error),
          });
        }
      }
      failures.push(...drainRuntimeFailures(runtime, context, pass.name));
    } catch (error) {
      failures.push({
        ...context,
        category: "fixture.demo",
        message: message(error),
      });
      failures.push(...drainRuntimeFailures(runtime, context, pass.name));
      checks += 1;
    }
  }
  return { checks, pass: { ...pass, frames: hashes } };
}

function expectedFrameKeys(
  items: readonly StateItem[],
  sources: Map<string, SourcePair>,
  defaultFps: number,
): string[] {
  return items.flatMap((item) => {
    const source = sources.get(item.id);
    if (source === undefined) return [];
    return buildCapturePoints(item, parseDemoTiming(source.demo, defaultFps)).map(
      (point) => `${item.id}:${point.key}`,
    );
  });
}

async function writeArtifacts(artifactsDir: string, report: RunReport): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });
  await Promise.all([
    writeFile(
      resolve(artifactsDir, "verification-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    ),
    ...report.hashes.passes.map((pass) =>
      writeFile(
        resolve(artifactsDir, `frame-hashes-${pass.name}.json`),
        `${JSON.stringify(pass.frames, null, 2)}\n`,
      ),
    ),
  ]);
}

function printReport(report: RunReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const { primitives, checks } = report.summary;
  console.log(
    `Operator Black: ${primitives.passed}/${primitives.total} primitives, ${checks.passed}/${checks.total} checks`,
  );
  console.log(
    `Frame hashes: ${report.hashes.passes.map((pass) => `${pass.name}=${Object.keys(pass.frames).length}/${report.hashes.expected}`).join(", ")}; matching=${report.hashes.matching}`,
  );
  for (const failure of report.failures) {
    const context = [
      failure.id,
      failure.fixture,
      failure.theme,
      failure.viewport,
      failure.checkpoint,
    ]
      .filter((value) => value !== undefined)
      .join("/");
    console.error(`${context ? `[${context}] ` : ""}${failure.category}: ${failure.message}`);
  }
}

function passesMatch(expectedKeys: string[], passes: FrameHashPass[]): boolean {
  const baseline = passes[0]?.frames;
  return (
    passes.length === 4 &&
    baseline !== undefined &&
    passes.every((pass) => sameExactKeys(expectedKeys, pass.frames)) &&
    passes.slice(1).every((pass) => compareFrameHashPasses(baseline, pass.frames).length === 0)
  );
}

function placeholderEnvironment(
  lock: ImageLock,
  puppeteerVersion: string,
  gsapSource: string,
): BrowserEnvironment {
  return {
    container: { ...lock.container, verified: false },
    puppeteer: puppeteerVersion,
    chromeForTesting: lock.chromeForTesting,
    browser: "not-launched",
    gsap: {
      path: relative(repoRoot, gsapPath),
      version: gsapVersion(gsapSource),
      sha256: sha256(gsapSource),
    },
    ...lock.environment,
    platform: platform(),
    architecture: arch(),
    osRelease: release(),
    fontFingerprint: "not-probed",
  };
}

export async function runCli(args = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(args);
  if (options.updateFrameHashes && options.only !== null) {
    throw new Error("--update-frame-hashes requires the complete 66-item run");
  }
  const [scopeValue, statesValue, checkpointsValue, imageLockValue, gsapSource] = await Promise.all(
    [
      readJson(scopePath),
      readJson(statesPath),
      readJson(checkpointsPath),
      readJson(imageLockPath),
      readFile(gsapPath, "utf8"),
    ],
  );
  const scope = parseScope(scopeValue);
  const states = parseStates(statesValue);
  const checkpoints = parseCheckpoints(checkpointsValue);
  const imageLock = parseImageLock(imageLockValue);
  const require = createRequire(import.meta.url);
  const puppeteerPackage = await readJson(require.resolve("puppeteer/package.json"));
  if (!isRecord(puppeteerPackage)) throw new Error("installed Puppeteer package is invalid");
  const puppeteerVersion = stringProperty(puppeteerPackage, "version", "puppeteer.package");
  let environment = placeholderEnvironment(imageLock, puppeteerVersion, gsapSource);
  const failures = validateVerificationModel({ scope, states, checkpoints });
  failures.push(...validateClosedStateFixtureCoverage(states.items));
  const selectedItems =
    options.only === null ? states.items : states.items.filter((item) => item.id === options.only);
  if (options.only !== null && selectedItems.length !== 1) {
    throw new Error(`--only must name one scoped primitive; received ${options.only}`);
  }
  if (failures.length > 0) {
    const report: RunReport = {
      version: 1,
      environment,
      summary: buildVerificationSummary(scope.items, failures.length, failures),
      failures,
      hashes: {
        expected: 0,
        passes: [],
        matching: false,
        published: false,
      },
    };
    printReport(report, options.json);
    return 1;
  }

  const axePath = require.resolve("axe-core/axe.min.js");
  const axeSource = await readFile(axePath, "utf8");
  const plan = buildRunPlan(selectedItems);
  const sources = await loadSources(
    selectedItems.map((item) => item.id),
    failures,
  );
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
      `--lang=${imageLock.environment.locale}`,
      ...(process.env.HF_UI_REQUIRE_LOCKED_ENV === "1"
        ? []
        : ["--no-sandbox", "--disable-setuid-sandbox"]),
    ],
  });
  let totalChecks = 0;
  const passes: FrameHashPass[] = [];
  let browserVersion = "unknown";
  try {
    browserVersion = await browser.version();
    const { page, runtime } = await createAuditedPage(browser);
    await page.emulateTimezone(imageLock.environment.timezone);
    const environmentSession = await page.createCDPSession();
    await environmentSession.send("Emulation.setLocaleOverride", {
      locale: imageLock.environment.locale,
    });
    await page.evaluateOnNewDocument(`
      Object.defineProperty(Navigator.prototype, "language", {
        configurable: true,
        get: () => ${JSON.stringify(imageLock.environment.locale)},
      });
      Object.defineProperty(Navigator.prototype, "languages", {
        configurable: true,
        get: () => [${JSON.stringify(imageLock.environment.locale)}],
      });
    `);
    const browserProbe = await probeBrowserEnvironment(page);
    const actualChromeVersion = browserVersion.split("/").at(-1) ?? browserVersion;
    const containerImage = process.env.HF_UI_CONTAINER_IMAGE ?? null;
    const containerDigest = process.env.HF_UI_CONTAINER_DIGEST ?? null;
    const lockEvidence: VisualLockEvidence = {
      containerImage,
      containerDigest,
      puppeteer: puppeteerVersion,
      chromeForTesting: actualChromeVersion,
      gsapPath: relative(repoRoot, gsapPath),
      gsapVersion: gsapVersion(gsapSource),
      gsapSha256: sha256(gsapSource),
      deviceScaleFactor: browserProbe.deviceScaleFactor,
      locale: browserProbe.locale,
      timezone: browserProbe.timezone,
    };
    const requireLockedEnvironment = process.env.HF_UI_REQUIRE_LOCKED_ENV === "1";
    failures.push(...validateVisualLock(imageLock, lockEvidence, requireLockedEnvironment));
    const containerVerified =
      requireLockedEnvironment &&
      containerImage === imageLock.container.image &&
      containerDigest === imageLock.container.digest &&
      platform() === "linux" &&
      arch() === "x64";
    environment = {
      container: { ...imageLock.container, verified: containerVerified },
      puppeteer: puppeteerVersion,
      chromeForTesting: actualChromeVersion,
      browser: browserVersion,
      gsap: {
        path: lockEvidence.gsapPath,
        version: lockEvidence.gsapVersion,
        sha256: lockEvidence.gsapSha256,
      },
      deviceScaleFactor: browserProbe.deviceScaleFactor,
      locale: browserProbe.locale,
      timezone: browserProbe.timezone,
      platform: platform(),
      architecture: arch(),
      osRelease: release(),
      fontFingerprint: browserProbe.fontFingerprint,
    };
    totalChecks += await verifyParity(page, runtime, selectedItems, sources, failures);
    totalChecks += await verifyCanonicalMatrix(
      page,
      runtime,
      plan.canonical,
      sources,
      axeSource,
      failures,
    );
    totalChecks += await verifyFocusModes(
      page,
      runtime,
      buildFocusRunPlan(selectedItems),
      sources,
      failures,
    );
    totalChecks += await verifySemanticStates(
      page,
      runtime,
      new Set(selectedItems.map((item) => item.id)),
      sources,
      axeSource,
      failures,
    );
    const passSpecs = buildPassSpecs(checkpoints.sequentialPasses, checkpoints.shuffledPasses);
    for (const [index, passSpec] of passSpecs.entries()) {
      const capture = await captureDemoPass(
        page,
        runtime,
        plan.demos,
        sources,
        gsapSource,
        checkpoints,
        passSpec,
        failures,
        index === 0,
      );
      passes.push(capture.pass);
      totalChecks += capture.checks;
    }
    const baseline = passes[0]?.frames ?? {};
    for (const pass of passes.slice(1)) {
      failures.push(
        ...compareFrameHashPasses(baseline, pass.frames).map((entry) => ({
          ...entry,
          message: `${pass.name}: ${entry.message}`,
        })),
      );
    }
    totalChecks += expectedFrameKeys(selectedItems, sources, checkpoints.fps).length * 3;
    await page.close();
  } finally {
    await browser.close();
  }

  const expectedKeys = expectedFrameKeys(selectedItems, sources, checkpoints.fps);
  const lockedFullRun =
    options.only === null && selectedItems.length === 66 && environment.container.verified;
  const artifact = lockedFullRun
    ? buildFrameHashArtifact(environment, expectedKeys, passes, failures)
    : null;
  let frameHashLockVerified = false;
  if (options.updateFrameHashes && !lockedFullRun) {
    failures.push({
      category: "determinism.lock-update-environment",
      message: "frame hashes may only be updated by a complete locked-container run",
    });
  } else if (artifact !== null && options.updateFrameHashes) {
    await writeFile(frameHashesPath, `${JSON.stringify(artifact, null, 2)}\n`);
    frameHashLockVerified = true;
  } else if (artifact !== null) {
    try {
      const expectedLock = await readJson(frameHashesPath);
      const lockFailures = auditFrameHashLock(expectedLock, artifact);
      failures.push(...lockFailures);
      frameHashLockVerified = lockFailures.length === 0;
    } catch (error) {
      failures.push({
        category: "determinism.lock-missing",
        message: `committed frame-hashes.json is required: ${message(error)}`,
      });
    }
  }
  const report: RunReport = {
    version: 1,
    environment,
    summary: buildVerificationSummary(
      selectedItems.map((item) => item.id),
      totalChecks,
      failures,
    ),
    failures,
    hashes: {
      expected: expectedKeys.length,
      passes,
      matching: passesMatch(expectedKeys, passes),
      published: frameHashLockVerified,
    },
  };
  if (options.artifactsDir !== null) {
    await writeArtifacts(resolve(options.artifactsDir), report);
  }
  printReport(report, options.json);
  return failures.length === 0 ? 0 : 1;
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && resolve(invoked) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  runCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(`Operator Black verifier failed to start: ${message(error)}`);
      process.exitCode = 1;
    });
}
