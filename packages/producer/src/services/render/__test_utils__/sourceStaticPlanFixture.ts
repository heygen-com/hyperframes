import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOURCE_STATIC_PLAN_PRODUCER_VERSION, type StaticPlanInput } from "../sourceStaticPlan.js";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export async function fixture(scratch: string[]) {
  const root = await mkdtemp(join(tmpdir(), "openmaic-static-plan-"));
  scratch.push(root);
  await mkdir(join(root, "assets", "slides"), { recursive: true });
  await mkdir(join(root, "assets", "vendor"), { recursive: true });
  const manifest = {
    schema: "openmaic.videoTimeline",
    version: 4,
    compiler: "openmaic-video-timeline",
    stage: { id: "stage" },
    totalDurationMs: 10_000,
    scenes: [
      {
        id: "scene",
        index: 0,
        type: "slide",
        startMs: 0,
        durationMs: 10_000,
        base: { kind: "slide-snapshot", assetRef: "slides/页.png" },
      },
    ],
    assets: { entries: [{ path: "slides/页.png", present: true }] },
  };
  const files = new Map([
    ["openmaic-video-manifest.json", Buffer.from(JSON.stringify(manifest))],
    ["index.html", Buffer.from('<script src="assets/vendor/gsap.min.js"></script>')],
    ["assets/vendor/gsap.min.js", Buffer.from("gsap")],
    ["assets/slides/页.png", Buffer.from("image")],
  ]);
  for (const [relative, bytes] of files) await writeFile(join(root, relative), bytes);
  const identity = (path: string) => ({
    path,
    size: files.get(path)!.length,
    sha256: hash(files.get(path)!),
  });
  const carrier = {
    schema: "openmaic.sourceStaticPlan",
    version: 1,
    planner: "openmaic-slide-snapshot-v1",
    producer: { package: "@hyperframes/producer", version: SOURCE_STATIC_PLAN_PRODUCER_VERSION },
    burnInSubtitles: false,
    fps: { num: 30, den: 1 },
    timeline: {
      schema: manifest.schema,
      version: manifest.version,
      compiler: manifest.compiler,
      stageId: "stage",
      durationMs: 10_000,
      totalFrames: 300,
    },
    intervals: [
      {
        startMs: 1000,
        endMs: 2000,
        startFrame: 30,
        endExclusiveFrame: 60,
        sceneId: "scene",
        sceneIndex: 0,
        sceneType: "slide",
        baseKind: "slide-snapshot",
        assetRef: "slides/页.png",
      },
    ],
    rejectedSceneReasons: {},
    excludedFrameReasons: {},
    identity: {
      manifest: identity("openmaic-video-manifest.json"),
      indexHtml: identity("index.html"),
      gsapVendorPath: "assets/vendor/gsap.min.js",
      runtimeDependencies: [identity("assets/vendor/gsap.min.js")],
      sourceAssets: [
        {
          assetRef: "slides/页.png",
          zipEntry: "assets/slides/页.png",
          size: files.get("assets/slides/页.png")!.length,
          sha256: hash(files.get("assets/slides/页.png")!),
        },
      ],
    },
  };
  await writeFile(join(root, "openmaic-source-static-plan.json"), `${JSON.stringify(carrier)}\n`);
  return { root, carrier };
}

export function eligibility(
  root: string,
  overrides: Partial<StaticPlanInput> = {},
): StaticPlanInput {
  return {
    enabled: true,
    projectDir: root,
    entryFile: "index.html",
    producerVersion: SOURCE_STATIC_PLAN_PRODUCER_VERSION,
    fps: { num: 30, den: 1 },
    totalFrames: 300,
    initialDirectSdrDiskEligible: true,
    capturePlanKind: "sdr_disk",
    workerCount: 1,
    chunked: false,
    captureMode: "beginframe",
    forceScreenshot: false,
    workerEncodeEnabled: false,
    staticDedupEnabled: false,
    staticDedupArmed: false,
    ...overrides,
  };
}
