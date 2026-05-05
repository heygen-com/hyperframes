#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  ActiveVisualRef,
  CompositionBuildManifest,
  RenderAspectRatio,
  ScenePlan,
  VideoProjectIdentity,
  VideoProjectPlan,
  VisualContextProviderKind,
  WorkflowBottleneck,
} from "../contracts/types.ts";

type JsonObject = { readonly [key: string]: unknown };

type CliArgs = {
  readonly plan: string;
  readonly outDir?: string;
};

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function readJson(filePath: string): JsonObject {
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  if (!isObject(parsed)) {
    throw new Error(`Expected JSON object in ${filePath}`);
  }
  return parsed;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    parsed[arg.slice(2)] = next;
    index += 1;
  }

  const plan = parsed.plan;
  if (!plan) {
    throw new Error(
      "Usage: bun run video-framework/scripts/build-composition.ts --plan <video-project-plan.json> [--out-dir <composition-dir>]",
    );
  }

  return {
    plan,
    outDir: parsed["out-dir"],
  };
}

function objectField(source: JsonObject, key: string, context: string): JsonObject {
  const value = source[key];
  if (!isObject(value)) {
    throw new Error(`Expected object at ${context}.${key}`);
  }
  return value;
}

function arrayField(source: JsonObject, key: string, context: string): readonly unknown[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    throw new Error(`Expected array at ${context}.${key}`);
  }
  return value;
}

function optionalArrayField(source: JsonObject, key: string): readonly unknown[] {
  const value = source[key];
  return Array.isArray(value) ? value : [];
}

function stringField(source: JsonObject, key: string, context: string): string {
  const value = source[key];
  if (!isString(value) || value.trim().length === 0) {
    throw new Error(`Expected non-empty string at ${context}.${key}`);
  }
  return value;
}

function optionalStringField(source: JsonObject, key: string): string | undefined {
  const value = source[key];
  return isString(value) && value.length > 0 ? value : undefined;
}

function numberField(source: JsonObject, key: string, context: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected finite number at ${context}.${key}`);
  }
  return value;
}

function parseAspectRatio(value: string, context: string): RenderAspectRatio {
  if (value === "16:9" || value === "9:16" || value === "1:1") return value;
  throw new Error(`Unsupported aspect ratio at ${context}: ${value}`);
}

function parseVisualContextProvider(value: string, context: string): VisualContextProviderKind {
  if (value === "none" || value === "palantir-math-sequencer" || value === "manual") {
    return value;
  }
  throw new Error(`Unsupported visual context provider at ${context}: ${value}`);
}

function parseBottleneckStatus(value: string, context: string): WorkflowBottleneck["status"] {
  if (value === "active" || value === "ready" || value === "blocked" || value === "deferred") {
    return value;
  }
  throw new Error(`Unsupported bottleneck status at ${context}: ${value}`);
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isString);
}

function numberArray(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function parseProject(source: JsonObject): VideoProjectIdentity {
  return {
    id: stringField(source, "id", "plan.project"),
    title: stringField(source, "title", "plan.project"),
    language: stringField(source, "language", "plan.project"),
    renderTarget: stringField(source, "renderTarget", "plan.project"),
    aspectRatio: parseAspectRatio(
      stringField(source, "aspectRatio", "plan.project"),
      "plan.project.aspectRatio",
    ),
    fps: numberField(source, "fps", "plan.project"),
  };
}

function parseActiveVisualRef(source: JsonObject, context: string): ActiveVisualRef {
  return {
    ref: stringField(source, "ref", context),
    meaning: optionalStringField(source, "meaning") ?? null,
  };
}

function parseScene(source: JsonObject, index: number): ScenePlan {
  const context = `plan.scenes[${index}]`;
  const time = objectField(source, "time", context);
  const cueRange = objectField(source, "cueRange", context);
  const visualContext = objectField(source, "visualContext", context);
  const frameSpanSource = visualContext.frameSpan;

  return {
    id: stringField(source, "id", context),
    label: stringField(source, "label", context),
    time: {
      start: stringField(time, "start", `${context}.time`),
      end: stringField(time, "end", `${context}.time`),
      durationSeconds: numberField(time, "durationSeconds", `${context}.time`),
    },
    cueRange: {
      first:
        typeof cueRange.first === "number" && Number.isInteger(cueRange.first)
          ? cueRange.first
          : null,
      last:
        typeof cueRange.last === "number" && Number.isInteger(cueRange.last) ? cueRange.last : null,
      count: numberField(cueRange, "count", `${context}.cueRange`),
    },
    visualContext: {
      frameSpan: isObject(frameSpanSource)
        ? {
            first: numberField(frameSpanSource, "first", `${context}.visualContext.frameSpan`),
            last: numberField(frameSpanSource, "last", `${context}.visualContext.frameSpan`),
          }
        : null,
      activeRefs: optionalArrayField(visualContext, "activeRefs")
        .filter(isObject)
        .map((ref, refIndex) =>
          parseActiveVisualRef(ref, `${context}.visualContext.activeRefs[${refIndex}]`),
        ),
      expressionRefs: stringArray(visualContext.expressionRefs),
      manualRefs: stringArray(visualContext.manualRefs),
    },
    transcriptSample: stringField(source, "transcriptSample", context),
    semanticGoal: stringField(source, "semanticGoal", context),
    captionPolicy: stringField(source, "captionPolicy", context),
    motionDirectives: stringArray(source.motionDirectives),
    bottleneckNotes: stringArray(source.bottleneckNotes),
  };
}

function parseBottleneck(source: JsonObject, index: number): WorkflowBottleneck {
  const context = `plan.bottlenecks[${index}]`;
  return {
    id: stringField(source, "id", context),
    status: parseBottleneckStatus(stringField(source, "status", context), `${context}.status`),
    reason: stringField(source, "reason", context),
    nextAction: stringField(source, "nextAction", context),
  };
}

function parsePlan(filePath: string): VideoProjectPlan {
  const plan = readJson(filePath);
  const schemaVersion = stringField(plan, "schemaVersion", "plan");
  if (schemaVersion !== "hyperframes-video-project-plan.v0") {
    throw new Error(`Unsupported plan schemaVersion: ${schemaVersion}`);
  }

  const metrics = objectField(plan, "metrics", "plan");
  const diagnostics = objectField(plan, "diagnostics", "plan");
  const cueCoverage = objectField(diagnostics, "cueCoverage", "plan.diagnostics");
  const sceneTiming = objectField(diagnostics, "sceneTiming", "plan.diagnostics");

  const sourceAuthority = objectField(plan, "sourceAuthority", "plan");

  return {
    schemaVersion,
    project: parseProject(objectField(plan, "project", "plan")),
    sourceAuthority: {
      primaryTimeline: stringField(sourceAuthority, "primaryTimeline", "plan.sourceAuthority"),
      transcriptPath: stringField(sourceAuthority, "transcriptPath", "plan.sourceAuthority"),
      whisperRole: stringField(sourceAuthority, "whisperRole", "plan.sourceAuthority"),
      visualContextProvider: parseVisualContextProvider(
        stringField(sourceAuthority, "visualContextProvider", "plan.sourceAuthority"),
        "plan.sourceAuthority.visualContextProvider",
      ),
      visualContextRule: stringField(sourceAuthority, "visualContextRule", "plan.sourceAuthority"),
    },
    promptInterpretation: [],
    metrics: {
      cueCount: numberField(metrics, "cueCount", "plan.metrics"),
      durationSeconds: numberField(metrics, "durationSeconds", "plan.metrics"),
      plannedSceneCount: numberField(metrics, "plannedSceneCount", "plan.metrics"),
      visualContextFrameCount: numberField(metrics, "visualContextFrameCount", "plan.metrics"),
    },
    diagnostics: {
      cueCoverage: {
        coveredCueCount: numberField(
          cueCoverage,
          "coveredCueCount",
          "plan.diagnostics.cueCoverage",
        ),
        uncoveredCueCount: numberField(
          cueCoverage,
          "uncoveredCueCount",
          "plan.diagnostics.cueCoverage",
        ),
        duplicatedCueCount: numberField(
          cueCoverage,
          "duplicatedCueCount",
          "plan.diagnostics.cueCoverage",
        ),
        uncoveredCueIndexSample: numberArray(cueCoverage.uncoveredCueIndexSample),
        duplicatedCueIndexSample: numberArray(cueCoverage.duplicatedCueIndexSample),
      },
      sceneTiming: {
        totalSceneSeconds: numberField(
          sceneTiming,
          "totalSceneSeconds",
          "plan.diagnostics.sceneTiming",
        ),
        transcriptDurationSeconds: numberField(
          sceneTiming,
          "transcriptDurationSeconds",
          "plan.diagnostics.sceneTiming",
        ),
        sceneCoverageRatio: numberField(
          sceneTiming,
          "sceneCoverageRatio",
          "plan.diagnostics.sceneTiming",
        ),
      },
      activeBottleneckIds: stringArray(diagnostics.activeBottleneckIds),
    },
    bottlenecks: arrayField(plan, "bottlenecks", "plan")
      .filter(isObject)
      .map((entry, index) => parseBottleneck(entry, index)),
    scenes: arrayField(plan, "scenes", "plan")
      .filter(isObject)
      .map((entry, index) => parseScene(entry, index)),
    nextLoop: stringArray(plan.nextLoop),
  };
}

function msFromSrt(value: string): number {
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(value);
  if (!match) throw new Error(`Invalid SRT-like time: ${value}`);
  const [, hh, mm, ss, ms] = match;
  return Number(hh) * 3_600_000 + Number(mm) * 60_000 + Number(ss) * 1_000 + Number(ms);
}

function seconds(value: number): number {
  return Number((value / 1_000).toFixed(3));
}

function secondsAttr(value: number): string {
  return String(Number(value.toFixed(3)));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeId(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "composition";
}

function viewportForAspectRatio(aspectRatio: RenderAspectRatio): {
  readonly width: number;
  readonly height: number;
} {
  if (aspectRatio === "9:16") return { width: 1080, height: 1920 };
  if (aspectRatio === "1:1") return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

function summarizeRefs(scene: ScenePlan): readonly string[] {
  const refs = scene.visualContext.activeRefs
    .slice(0, 6)
    .map((entry) => (entry.meaning ? `${entry.ref}: ${entry.meaning}` : entry.ref));
  if (refs.length > 0) return refs;
  if (scene.visualContext.expressionRefs.length > 0)
    return scene.visualContext.expressionRefs.slice(0, 6);
  return scene.visualContext.manualRefs.slice(0, 6);
}

function sceneFileName(scene: ScenePlan): string {
  return `${sanitizeId(scene.id)}.html`;
}

function sceneCompositionId(scene: ScenePlan): string {
  return `scene-${sanitizeId(scene.id)}`;
}

function buildSceneMountHtml(scene: ScenePlan, index: number): string {
  const startSeconds = seconds(msFromSrt(scene.time.start));
  const duration = scene.time.durationSeconds;
  const trackIndex = 1 + (index % 4);
  return `<div id="${escapeHtml(sceneCompositionId(scene))}-mount" data-composition-id="${escapeHtml(sceneCompositionId(scene))}" data-composition-src="compositions/${escapeHtml(sceneFileName(scene))}" data-start="${secondsAttr(startSeconds)}" data-duration="${secondsAttr(duration)}" data-track-index="${trackIndex}" data-width="1920" data-height="1080"></div>`;
}

function buildSceneBodyHtml(scene: ScenePlan, index: number): string {
  const cueLabel =
    scene.cueRange.first === null || scene.cueRange.last === null
      ? "No cue range"
      : `Cues ${scene.cueRange.first}-${scene.cueRange.last}`;
  const refs = summarizeRefs(scene);
  const refMarkup =
    refs.length > 0
      ? refs.map((ref) => `<span>${escapeHtml(ref)}</span>`).join("")
      : "<span>No active visual refs</span>";
  const directive = scene.motionDirectives[0] ?? "Hold the semantic layout before adding motion.";

  return `<section class="scene scene-tone-${index % 5}">
  <div class="scene-kicker">Scene ${String(index + 1).padStart(2, "0")} · ${escapeHtml(cueLabel)}</div>
  <h1>${escapeHtml(scene.label)}</h1>
  <p class="goal">${escapeHtml(scene.semanticGoal)}</p>
  <p class="caption">${escapeHtml(scene.transcriptSample)}</p>
  <div class="refs">${refMarkup}</div>
  <p class="directive">${escapeHtml(directive)}</p>
</section>`;
}

function buildSceneCompositionHtml(
  plan: VideoProjectPlan,
  scene: ScenePlan,
  index: number,
): string {
  const viewport = viewportForAspectRatio(plan.project.aspectRatio);
  const compositionId = sceneCompositionId(scene);
  const duration = scene.time.durationSeconds;
  const sceneBody = buildSceneBodyHtml(scene, index);

  return `<template id="${escapeHtml(compositionId)}-template">
  <div id="${escapeHtml(compositionId)}" data-composition-id="${escapeHtml(compositionId)}" data-width="${viewport.width}" data-height="${viewport.height}">
    <style>
      * { box-sizing: border-box; }
      #${escapeHtml(compositionId)} { position: relative; width: ${viewport.width}px; height: ${viewport.height}px; overflow: hidden; background: linear-gradient(135deg, #f7f4ed 0%, #eef6f4 48%, #f4f0ff 100%); color: #161616; font-family: Inter, Arial, sans-serif; }
      #${escapeHtml(compositionId)}::before { content: ""; position: absolute; inset: 40px; border: 2px solid rgba(22, 22, 22, 0.16); pointer-events: none; }
      .scene { position: absolute; inset: 116px 80px 80px; display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(420px, 0.8fr); grid-template-rows: auto auto minmax(0, 1fr) auto; gap: 22px 44px; padding: 56px; border: 2px solid rgba(22, 22, 22, 0.18); background: rgba(255, 255, 255, 0.86); box-shadow: 0 18px 60px rgba(36, 49, 47, 0.12); }
      .scene-kicker { grid-column: 1 / -1; font-size: 24px; font-weight: 800; color: #8b2f2b; text-transform: uppercase; }
      h1 { margin: 0; font-size: 64px; line-height: 1.04; color: #161616; }
      .goal { margin: 0; font-size: 31px; line-height: 1.3; color: #24312f; }
      .caption { grid-row: 3 / 5; margin: 0; align-self: end; padding: 30px 34px; border-left: 8px solid #236c67; background: #fffaf0; font-size: 30px; line-height: 1.38; color: #161616; }
      .refs { display: flex; flex-wrap: wrap; align-content: start; gap: 12px; }
      .refs span { max-width: 100%; padding: 12px 16px; border: 1px solid rgba(35, 108, 103, 0.34); background: #e6f5f2; color: #173f3c; font-size: 22px; line-height: 1.25; }
      .directive { margin: 0; align-self: end; padding: 22px 24px; border: 2px solid rgba(38, 32, 63, 0.24); background: #f2e7b8; color: #161616; font-size: 24px; line-height: 1.3; }
      .scene-tone-1 .caption { border-color: #5b4b75; }
      .scene-tone-2 .caption { border-color: #8b2f2b; }
      .scene-tone-3 .caption { border-color: #315f9b; }
      .scene-tone-4 .caption { border-color: #706117; }
    </style>
    ${sceneBody}
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["${escapeHtml(compositionId)}"] = {
        seek() {},
        duration() { return ${secondsAttr(duration)}; },
        pause() {},
      };
    </script>
  </div>
</template>
`;
}

function buildIndexHtml(plan: VideoProjectPlan): string {
  const viewport = viewportForAspectRatio(plan.project.aspectRatio);
  const compositionId = sanitizeId(plan.project.id);
  const scenes = plan.scenes.map((scene, index) => buildSceneMountHtml(scene, index)).join("\n");
  const activeBottlenecks = plan.bottlenecks
    .filter((bottleneck) => bottleneck.status === "active" || bottleneck.status === "blocked")
    .map((bottleneck) => bottleneck.id)
    .join(", ");

  return `<!doctype html>
<html lang="${escapeHtml(plan.project.language)}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${viewport.width}, height=${viewport.height}" />
  <title>${escapeHtml(plan.project.title)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: ${viewport.width}px; height: ${viewport.height}px; overflow: hidden; background: #f7f4ed; color: #161616; font-family: Inter, Arial, sans-serif; }
    #root { position: relative; width: ${viewport.width}px; height: ${viewport.height}px; overflow: hidden; background: #f7f4ed; }
    .project-header { position: absolute; left: 80px; right: 80px; top: 56px; display: flex; justify-content: space-between; gap: 32px; font-size: 24px; font-weight: 700; color: #24312f; z-index: 10; }
    .project-header span:last-child { font-weight: 500; color: #5b4b75; }
    [data-composition-src] { position: absolute; inset: 0; width: ${viewport.width}px; height: ${viewport.height}px; }
  </style>
</head>
<body>
  <div id="root" data-composition-id="${escapeHtml(compositionId)}" data-start="0" data-duration="${secondsAttr(plan.metrics.durationSeconds)}" data-width="${viewport.width}" data-height="${viewport.height}">
    <div class="project-header"><span>${escapeHtml(plan.project.title)}</span><span>Active bottlenecks: ${escapeHtml(activeBottlenecks || "none")}</span></div>
${scenes}
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["${escapeHtml(compositionId)}"] = {
      seek() {},
      duration() { return ${secondsAttr(plan.metrics.durationSeconds)}; },
      pause() {},
    };
  </script>
</body>
</html>
`;
}

function buildManifest(
  planPath: string,
  outputDir: string,
  plan: VideoProjectPlan,
): CompositionBuildManifest {
  const sourcePlanPath = path.relative(outputDir, planPath);
  const outputDirForManifest = path.relative(process.cwd(), outputDir) || ".";
  const sceneFiles = plan.scenes.map((scene) => ({
    path: `compositions/${sceneFileName(scene)}`,
    role: "scene-composition" as const,
    derivedFrom: ["VideoProjectPlan.scenes", `ScenePlan.${scene.id}`],
  }));
  return {
    schemaVersion: "hyperframes-composition-build.v0",
    sourcePlanPath,
    outputDir: outputDirForManifest,
    layoutStrategy:
      "root composition mounts one generated sub-composition per semantic scene; scene clips are timed from the reviewed VideoProjectPlan and advanced animation is deferred",
    files: [
      {
        path: "index.html",
        role: "root-composition",
        derivedFrom: [
          "VideoProjectPlan.project",
          "VideoProjectPlan.scenes",
          "VideoProjectPlan.metrics",
        ],
      },
      ...sceneFiles,
      {
        path: "build-manifest.json",
        role: "build-manifest",
        derivedFrom: ["VideoProjectPlan.diagnostics", "VideoProjectPlan.bottlenecks"],
      },
    ],
    diagnostics: {
      sceneCount: plan.scenes.length,
      durationSeconds: plan.metrics.durationSeconds,
      unresolvedBottleneckIds: plan.diagnostics.activeBottleneckIds,
    },
    validationCommands: [
      `npx hyperframes lint ${outputDirForManifest}`,
      `npx hyperframes validate ${outputDirForManifest}`,
      `npx hyperframes inspect ${outputDirForManifest}`,
    ],
  };
}

function formatFile(filePath: string): void {
  const result = spawnSync("bunx", ["oxfmt", filePath], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status === 0) return;

  const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  throw new Error(`oxfmt failed for ${filePath}${detail ? `:\n${detail}` : ""}`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const planPath = path.resolve(args.plan);
  const outputDir = path.resolve(
    args.outDir ?? path.join(path.dirname(planPath), "..", "composition"),
  );
  const plan = parsePlan(planPath);
  const indexPath = path.join(outputDir, "index.html");
  const compositionsDir = path.join(outputDir, "compositions");
  const manifestPath = path.join(outputDir, "build-manifest.json");

  rmSync(compositionsDir, { force: true, recursive: true });
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(compositionsDir, { recursive: true });
  writeFileSync(indexPath, buildIndexHtml(plan), "utf8");
  for (let index = 0; index < plan.scenes.length; index += 1) {
    const scene = plan.scenes[index];
    if (!scene) continue;
    const scenePath = path.join(compositionsDir, sceneFileName(scene));
    writeFileSync(scenePath, buildSceneCompositionHtml(plan, scene, index), "utf8");
    formatFile(scenePath);
  }
  writeFileSync(
    manifestPath,
    `${JSON.stringify(buildManifest(planPath, outputDir, plan), null, 2)}\n`,
    "utf8",
  );
  formatFile(indexPath);
  formatFile(manifestPath);
  console.log(outputDir);
}

main();
