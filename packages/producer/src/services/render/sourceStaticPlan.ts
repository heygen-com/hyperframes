import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, copyFile, link, lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { version as producerVersion } from "../../../package.json";

/** Match the carrier against this build's package version, not a version range. */
export const SOURCE_STATIC_PLAN_PRODUCER_VERSION = producerVersion;
interface Fps {
  num: number;
  den: number;
}
interface Identity {
  path?: string;
  zipEntry?: string;
  size: number;
  sha256: string;
}
interface AssetIdentity extends Identity {
  assetRef: string;
  zipEntry: string;
}
interface Interval {
  startMs: number;
  endMs: number;
  startFrame: number;
  endExclusiveFrame: number;
  sceneId: string;
  sceneIndex: number;
  sceneType: string;
  baseKind: string;
  assetRef: string;
}
interface Carrier {
  schema: string;
  version: number;
  planner: string;
  producer: { package: string; version: string };
  burnInSubtitles: boolean;
  fps: Fps;
  timeline: {
    schema: string;
    version: number;
    compiler: string;
    stageId: string;
    durationMs: number;
    totalFrames: number;
  };
  identity: {
    manifest: Identity;
    indexHtml: Identity;
    runtimeDependencies: Identity[];
    gsapVendorPath: string;
    sourceAssets: AssetIdentity[];
  };
  intervals: Interval[];
}
interface Scene {
  id: string;
  index: number;
  type: string;
  startMs: number;
  durationMs: number;
  base: { kind: string; assetRef?: string };
}
interface Manifest {
  schema: string;
  version: number;
  compiler: string;
  stage: { id: string };
  totalDurationMs: number;
  scenes: Scene[];
  assets: { entries: { present: boolean; path: string }[] };
}
export interface StaticPlanInput {
  enabled?: boolean;
  projectDir?: string;
  producerVersion: string;
  fps: Fps;
  totalFrames: number;
  initialDirectSdrDiskEligible?: boolean;
  capturePlanKind: string;
  workerCount: number;
  chunked?: boolean;
  frameRange?: { startFrame: number; endFrame: number };
  captureMode?: string;
  forceScreenshot?: boolean;
  workerEncodeEnabled?: boolean;
  staticDedupEnabled?: boolean;
  staticDedupArmed?: boolean;
}
export interface ScheduleItem {
  startFrame: number;
  durationFrames: number;
}
export interface StaticPlanSchedule {
  mode: "baseline" | "optimized";
  reason: string;
  items: ScheduleItem[];
  carrierSha256?: string;
}
interface FileOperations {
  link: typeof link;
  copyFile: typeof copyFile;
}
export interface DiskScheduleInput {
  schedule: Pick<StaticPlanSchedule, "items">;
  framesDir: string;
  extension: "jpg" | "png";
  assertNotAborted: () => void;
  capture: (index: number) => Promise<unknown>;
  reportFrame: (index: number) => void;
  operations?: Partial<FileOperations>;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function identity(value: unknown): value is Identity {
  return (
    record(value) &&
    typeof value.size === "number" &&
    typeof value.sha256 === "string" &&
    (value.path === undefined || typeof value.path === "string") &&
    (value.zipEntry === undefined || typeof value.zipEntry === "string")
  );
}
function assetIdentity(value: unknown): value is AssetIdentity {
  return (
    identity(value) &&
    "assetRef" in value &&
    typeof value.assetRef === "string" &&
    typeof value.zipEntry === "string"
  );
}
function interval(value: unknown): value is Interval {
  return (
    record(value) &&
    ["startMs", "endMs", "startFrame", "endExclusiveFrame", "sceneIndex"].every(
      (k) => typeof value[k] === "number",
    ) &&
    ["sceneId", "sceneType", "baseKind", "assetRef"].every((k) => typeof value[k] === "string")
  );
}
function carrierShape(value: unknown): value is Carrier {
  if (
    !record(value) ||
    !record(value.producer) ||
    !record(value.fps) ||
    !record(value.timeline) ||
    !record(value.identity)
  )
    return false;
  const { producer, fps, timeline, identity: ids } = value;
  return (
    typeof value.schema === "string" &&
    typeof value.version === "number" &&
    typeof value.planner === "string" &&
    typeof value.burnInSubtitles === "boolean" &&
    typeof producer.package === "string" &&
    typeof producer.version === "string" &&
    typeof fps.num === "number" &&
    typeof fps.den === "number" &&
    ["schema", "compiler", "stageId"].every((k) => typeof timeline[k] === "string") &&
    ["version", "durationMs", "totalFrames"].every((k) => typeof timeline[k] === "number") &&
    identity(ids.manifest) &&
    identity(ids.indexHtml) &&
    typeof ids.gsapVendorPath === "string" &&
    Array.isArray(ids.runtimeDependencies) &&
    ids.runtimeDependencies.every(identity) &&
    Array.isArray(ids.sourceAssets) &&
    ids.sourceAssets.every(assetIdentity) &&
    Array.isArray(value.intervals) &&
    value.intervals.every(interval)
  );
}
function scene(value: unknown): value is Scene {
  return (
    record(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    ["index", "startMs", "durationMs"].every((k) => typeof value[k] === "number") &&
    record(value.base) &&
    typeof value.base.kind === "string" &&
    (value.base.assetRef === undefined || typeof value.base.assetRef === "string")
  );
}
function manifestShape(value: unknown): value is Manifest {
  return (
    record(value) &&
    typeof value.schema === "string" &&
    typeof value.version === "number" &&
    typeof value.compiler === "string" &&
    typeof value.totalDurationMs === "number" &&
    record(value.stage) &&
    typeof value.stage.id === "string" &&
    Array.isArray(value.scenes) &&
    value.scenes.every(scene) &&
    record(value.assets) &&
    Array.isArray(value.assets.entries) &&
    value.assets.entries.every(
      (a) => record(a) && typeof a.present === "boolean" && typeof a.path === "string",
    )
  );
}
class InvalidStaticPlan extends Error {}

export const CARRIER_PATH = "openmaic-source-static-plan.json";
const ALLOWED_COPY_CODES = new Set(["EXDEV", "EPERM", "EACCES", "ENOTSUP"]);
const SUPPORTED_FPS = new Set(["24/1", "30/1", "60/1"]);
const HASH = /^[a-f0-9]{64}$/;

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function baseline(totalFrames: number, reason: string): StaticPlanSchedule {
  return {
    mode: "baseline",
    reason,
    items: Array.from({ length: totalFrames }, (_, startFrame) => ({
      startFrame,
      durationFrames: 1,
    })),
  };
}

function fail(reason: string): never {
  throw new InvalidStaticPlan(reason);
}

function safeEntry(root: string, entry: string | undefined) {
  if (
    typeof entry !== "string" ||
    entry.length === 0 ||
    entry.includes("\\") ||
    entry.startsWith("/")
  ) {
    fail("unsafe_path");
  }
  const target = resolve(root, entry);
  const rel = relative(resolve(root), target);
  if (rel.startsWith("..") || (rel === "" && entry !== ".")) fail("unsafe_path");
  return target;
}

async function verifyFile(root: string, identity: Identity) {
  if (
    !identity ||
    !Number.isSafeInteger(identity.size) ||
    identity.size < 0 ||
    !HASH.test(identity.sha256)
  ) {
    fail("malformed_identity");
  }
  const path = safeEntry(root, identity.path ?? identity.zipEntry);
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size !== identity.size)
    fail("file_identity_mismatch");
  const bytes = await readFile(path);
  if (sha256(bytes) !== identity.sha256) fail("file_identity_mismatch");
  return bytes;
}

function totalFramesForDurationMs(durationMs: number, fps: Fps) {
  const r = BigInt(durationMs) * BigInt(fps.num);
  const q = 1000n * BigInt(fps.den);
  const nearest = (2n * r + q) / (2n * q);
  const delta = r >= nearest * q ? r - nearest * q : nearest * q - r;
  return Number(delta * 1000n <= q ? nearest : (r + q - 1n) / q);
}

function frameAtOrAfter(ms: number, fps: Fps) {
  const r = BigInt(ms) * BigInt(fps.num);
  const q = 1000n * BigInt(fps.den);
  return Number((r + q - 1n) / q);
}

function referencedRuntimePaths(indexBytes: Buffer) {
  const html = indexBytes.toString("utf8");
  const paths = new Set<string>();
  for (const match of html.matchAll(/(?:(?:src|href)=|url\()["']?([^"')]+)["']?\)?/g)) {
    const path = match[1];
    if (path === undefined) continue;
    if (!/\.(?:js|css|woff2?|ttf|otf)(?:\?|$)/i.test(path)) continue;
    if (/^(?:https?:|\/\/)/i.test(path)) fail("external_runtime_dependency");
    if (path.startsWith("data:")) continue;
    paths.add(path.replace(/^\.\//, ""));
  }
  return [...paths].sort();
}

function buildSchedule(intervals: Interval[], totalFrames: number) {
  const items: ScheduleItem[] = [];
  let cursor = 0;
  for (const interval of intervals) {
    while (cursor < interval.startFrame) items.push({ startFrame: cursor++, durationFrames: 1 });
    items.push({
      startFrame: interval.startFrame,
      durationFrames: interval.endExclusiveFrame - interval.startFrame,
    });
    cursor = interval.endExclusiveFrame;
  }
  while (cursor < totalFrames) items.push({ startFrame: cursor++, durationFrames: 1 });
  if (items.reduce((sum, item) => sum + item.durationFrames, 0) !== totalFrames)
    fail("schedule_coverage");
  return items;
}

/** Complete pre-capture validation. A rejection always returns the dense baseline schedule. */
export async function resolveOpenMaicStaticPlan(
  input: StaticPlanInput,
): Promise<StaticPlanSchedule> {
  const fallback = (reason: string) => baseline(input.totalFrames, reason);
  if (input.enabled !== true) return fallback("disabled");
  if (input.initialDirectSdrDiskEligible !== true) return fallback("not_initial_direct_sdr_disk");
  if (input.capturePlanKind !== "sdr_disk") return fallback("wrong_backend");
  if (input.workerCount !== 1 || input.chunked === true || input.frameRange !== undefined) {
    return fallback("unsupported_parallel_or_chunk_path");
  }
  if (
    input.captureMode !== "beginframe" ||
    input.forceScreenshot === true ||
    input.workerEncodeEnabled === true
  ) {
    return fallback("unsupported_capture_mode");
  }
  if (input.staticDedupEnabled === true || input.staticDedupArmed === true)
    return fallback("hf_static_dedup_armed");

  try {
    if (!input.projectDir) return fallback("carrier_unreadable");
    const carrierPath = safeEntry(input.projectDir, CARRIER_PATH);
    const carrierBytes = await readFile(carrierPath);
    const carrier: unknown = JSON.parse(carrierBytes.toString("utf8"));
    if (!carrierShape(carrier)) fail("malformed_carrier");
    if (
      carrier.schema !== "openmaic.sourceStaticPlan" ||
      carrier.version !== 1 ||
      carrier.planner !== "openmaic-slide-snapshot-v1"
    )
      fail("schema");
    if (
      carrier.producer?.package !== "@hyperframes/producer" ||
      carrier.producer?.version !== input.producerVersion
    )
      fail("producer_identity");
    if (carrier.burnInSubtitles !== false) fail("burn_in_subtitles");
    if (!SUPPORTED_FPS.has(`${input.fps.num}/${input.fps.den}`)) fail("fps");
    if (carrier.fps?.num !== input.fps.num || carrier.fps?.den !== input.fps.den)
      fail("fps_identity");
    if (!Number.isSafeInteger(carrier.timeline?.durationMs) || carrier.timeline.durationMs < 0)
      fail("timeline_duration");
    if (
      carrier.timeline.totalFrames !== input.totalFrames ||
      totalFramesForDurationMs(carrier.timeline.durationMs, input.fps) !== input.totalFrames
    )
      fail("total_frames");

    const manifestBytes = await verifyFile(input.projectDir, carrier.identity?.manifest);
    const indexBytes = await verifyFile(input.projectDir, carrier.identity?.indexHtml);
    if (
      carrier.identity?.manifest?.path !== "openmaic-video-manifest.json" ||
      carrier.identity?.indexHtml?.path !== "index.html"
    )
      fail("runtime_closure");
    if (
      !Array.isArray(carrier.identity?.runtimeDependencies) ||
      carrier.identity.runtimeDependencies.length === 0
    )
      fail("runtime_closure");
    const runtimePaths = carrier.identity.runtimeDependencies.map((identity) => identity.path);
    if (
      typeof carrier.identity.gsapVendorPath !== "string" ||
      !runtimePaths.includes(carrier.identity.gsapVendorPath)
    )
      fail("runtime_closure");
    if (JSON.stringify(runtimePaths) !== JSON.stringify([...new Set(runtimePaths)].sort()))
      fail("runtime_closure");
    for (const identity of carrier.identity.runtimeDependencies)
      await verifyFile(input.projectDir, identity);
    if (JSON.stringify(runtimePaths) !== JSON.stringify(referencedRuntimePaths(indexBytes)))
      fail("runtime_closure");
    if (!Array.isArray(carrier.identity?.sourceAssets)) fail("asset_closure");
    const assets = new Map<string, AssetIdentity>();
    for (const identity of carrier.identity.sourceAssets) {
      if (
        assets.has(identity.assetRef) ||
        identity.zipEntry !== `assets/${identity.assetRef}` ||
        identity.assetRef?.includes("\\") ||
        identity.assetRef?.startsWith("/") ||
        identity.assetRef?.split("/").includes("..")
      )
        fail("asset_closure");
      await verifyFile(input.projectDir, identity);
      assets.set(identity.assetRef, identity);
    }
    if (JSON.stringify([...assets.keys()]) !== JSON.stringify([...assets.keys()].sort()))
      fail("asset_closure");
    const manifest: unknown = JSON.parse(manifestBytes.toString("utf8"));
    if (!manifestShape(manifest)) fail("malformed_manifest");
    if (
      manifest.schema !== carrier.timeline.schema ||
      manifest.version !== carrier.timeline.version ||
      manifest.compiler !== carrier.timeline.compiler ||
      manifest.stage?.id !== carrier.timeline.stageId ||
      manifest.totalDurationMs !== carrier.timeline.durationMs
    )
      fail("timeline_identity");
    const scenes = new Map((manifest.scenes ?? []).map((scene) => [scene.id, scene]));
    const presentManifestAssets = new Set(
      (manifest.assets?.entries ?? [])
        .filter((asset) => asset.present === true)
        .map((asset) => asset.path),
    );
    const intervals = carrier.intervals;
    if (!Array.isArray(intervals) || intervals.length === 0) fail("zero_coverage");
    let previousEnd = 0;
    for (const interval of intervals) {
      if (
        !Number.isSafeInteger(interval.startMs) ||
        !Number.isSafeInteger(interval.endMs) ||
        !Number.isSafeInteger(interval.startFrame) ||
        !Number.isSafeInteger(interval.endExclusiveFrame) ||
        interval.startMs < 0 ||
        interval.endMs <= interval.startMs ||
        interval.endMs > carrier.timeline.durationMs ||
        interval.startFrame < previousEnd ||
        interval.endExclusiveFrame <= interval.startFrame ||
        interval.endExclusiveFrame > input.totalFrames
      )
        fail("interval_structure");
      const scene = scenes.get(interval.sceneId);
      if (
        !scene ||
        scene.index !== interval.sceneIndex ||
        scene.type !== "slide" ||
        scene.base?.kind !== "slide-snapshot" ||
        scene.base.assetRef !== interval.assetRef ||
        interval.sceneType !== "slide" ||
        interval.baseKind !== "slide-snapshot" ||
        interval.startMs < scene.startMs ||
        interval.endMs > scene.startMs + scene.durationMs ||
        interval.startFrame !== frameAtOrAfter(interval.startMs, input.fps) ||
        interval.endExclusiveFrame !== frameAtOrAfter(interval.endMs, input.fps) ||
        !assets.has(interval.assetRef) ||
        !presentManifestAssets.has(interval.assetRef)
      )
        fail("scene_asset_binding");
      previousEnd = interval.endExclusiveFrame;
    }
    const referenced = [...new Set(intervals.map((interval) => interval.assetRef))].sort();
    if (JSON.stringify(referenced) !== JSON.stringify([...assets.keys()].sort()))
      fail("asset_closure");
    return {
      mode: "optimized",
      reason: "valid",
      carrierSha256: sha256(carrierBytes),
      items: buildSchedule(intervals, input.totalFrames),
    };
  } catch (error) {
    return fallback(error instanceof InvalidStaticPlan ? error.message : "carrier_unreadable");
  }
}

function frameName(index: number, extension: string) {
  return `frame_${String(index).padStart(6, "0")}.${extension}`;
}

async function regularNonEmpty(path: string) {
  const info = await lstat(path).catch(() => null);
  return Boolean(info?.isFile() && !info.isSymbolicLink() && info.size > 0);
}

async function materializeOne(anchor: string, destination: string, operations: FileOperations) {
  if (!(await regularNonEmpty(anchor)))
    throw new Error("static-plan anchor is missing, empty, or non-regular");
  if (await lstat(destination).catch(() => null))
    throw new Error("static-plan destination already exists");
  try {
    await operations.link(anchor, destination);
    return "link";
  } catch (error) {
    if (!record(error) || typeof error.code !== "string" || !ALLOWED_COPY_CODES.has(error.code))
      throw error;
    await operations.copyFile(anchor, destination, fsConstants.COPYFILE_EXCL);
    const [anchorBytes, destinationBytes] = await Promise.all([
      readFile(anchor),
      readFile(destination),
    ]);
    if (
      anchorBytes.byteLength !== destinationBytes.byteLength ||
      sha256(anchorBytes) !== sha256(destinationBytes)
    ) {
      throw new Error("static-plan copied frame identity mismatch");
    }
    return "copy";
  }
}

/** Optimized schedule consumer. Default-off and rejected plans stay on producer's original loop. */
export async function executeOpenMaicDiskSchedule(input: DiskScheduleInput) {
  const operations = { link, copyFile, ...(input.operations ?? {}) };
  let physicalCaptures = 0;
  let linkedFrames = 0;
  let copiedFrames = 0;
  for (const item of input.schedule.items) {
    input.assertNotAborted();
    await input.capture(item.startFrame);
    physicalCaptures += 1;
    input.reportFrame(item.startFrame);
    const anchor = join(input.framesDir, frameName(item.startFrame, input.extension));
    for (let offset = 1; offset < item.durationFrames; offset += 1) {
      input.assertNotAborted();
      const logicalFrame = item.startFrame + offset;
      const destination = join(input.framesDir, frameName(logicalFrame, input.extension));
      const method = await materializeOne(anchor, destination, operations);
      if (method === "link") linkedFrames += 1;
      else copiedFrames += 1;
      input.reportFrame(logicalFrame);
      input.assertNotAborted();
    }
  }
  return { physicalCaptures, linkedFrames, copiedFrames };
}

export async function verifyDenseFrameDirectory(
  framesDir: string,
  totalFrames: number,
  extension: string,
) {
  const names = (await readdir(framesDir)).sort();
  const expected = Array.from({ length: totalFrames }, (_, index) => frameName(index, extension));
  if (JSON.stringify(names) !== JSON.stringify(expected))
    throw new Error("static-plan dense frame inventory mismatch");
  for (const name of names) {
    const path = join(framesDir, name);
    if (!(await regularNonEmpty(path))) throw new Error(`invalid dense frame: ${name}`);
    await access(path, fsConstants.R_OK);
    if (dirname(path) !== resolve(framesDir)) throw new Error("dense frame path escaped framesDir");
  }
}
