#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  ActiveVisualRef,
  FrameSpan,
  PlanDiagnostics,
  RecordedMediaInput,
  RenderAspectRatio,
  RequirementSource,
  SceneMapEntry,
  ScenePlan,
  TranscriptCue,
  TranscriptInput,
  TranscriptSourceKind,
  VideoProjectIdentity,
  VideoProjectInputs,
  VideoProjectManifest,
  VideoProjectPlan,
  VisualContextConfig,
  VisualContextProviderKind,
  WhisperRuntimeInput,
  WorkflowBottleneck,
  WorkflowConfig,
} from "../contracts/types.ts";

type JsonObject = { readonly [key: string]: unknown };

type CliArgs = {
  readonly project: string;
  readonly out?: string;
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

  const project = parsed.project;
  if (!project) {
    throw new Error(
      "Usage: bun run video-framework/scripts/build-project-plan.ts --project <project.json> [--out <plan.json>]",
    );
  }

  return {
    project,
    out: parsed.out,
  };
}

function objectField(source: JsonObject, key: string, context: string): JsonObject {
  const value = source[key];
  if (!isObject(value)) {
    throw new Error(`Expected object at ${context}.${key}`);
  }
  return value;
}

function optionalObjectField(source: JsonObject, key: string): JsonObject | null {
  const value = source[key];
  return isObject(value) ? value : null;
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

function parseTranscriptSourceKind(value: string, context: string): TranscriptSourceKind {
  if (value === "script" || value === "srt" || value === "mp4") return value;
  throw new Error(`Unsupported transcript source kind at ${context}: ${value}`);
}

function parseVisualContextProvider(value: string, context: string): VisualContextProviderKind {
  if (value === "none" || value === "palantir-math-sequencer" || value === "manual") {
    return value;
  }
  throw new Error(`Unsupported visual context provider at ${context}: ${value}`);
}

function parseAspectRatio(value: string, context: string): RenderAspectRatio {
  if (value === "16:9" || value === "9:16" || value === "1:1") return value;
  throw new Error(`Unsupported aspect ratio at ${context}: ${value}`);
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

function parseRequirements(source: JsonObject): readonly RequirementSource[] {
  return arrayField(source, "requirements", "manifest")
    .filter(isObject)
    .map((entry, index) => ({
      source: stringField(entry, "source", `manifest.requirements[${index}]`),
      meaning: stringField(entry, "meaning", `manifest.requirements[${index}]`),
    }));
}

function parseTranscriptInput(source: JsonObject): TranscriptInput {
  const kind = parseTranscriptSourceKind(
    stringField(source, "kind", "manifest.inputs.transcript"),
    "manifest.inputs.transcript.kind",
  );
  return {
    kind,
    path: stringField(source, "path", "manifest.inputs.transcript"),
    authority: stringField(source, "authority", "manifest.inputs.transcript"),
  };
}

function parseRecordedMediaInput(source: JsonObject): RecordedMediaInput {
  const kind = stringField(source, "kind", "manifest.inputs.recordedMedia");
  if (kind !== "mp4") {
    throw new Error(`Unsupported recorded media kind: ${kind}`);
  }
  const status = stringField(source, "status", "manifest.inputs.recordedMedia");
  if (status !== "pending-user-provided" && status !== "available") {
    throw new Error(`Unsupported recorded media status: ${status}`);
  }
  return {
    kind,
    path: optionalStringField(source, "path"),
    status,
  };
}

function parseWhisperInput(source: JsonObject): WhisperRuntimeInput {
  const role = stringField(source, "role", "manifest.inputs.whisper");
  if (role !== "caption-generation" && role !== "timing-validation" && role !== "disabled") {
    throw new Error(`Unsupported whisper role: ${role}`);
  }
  return {
    binaryPath: stringField(source, "binaryPath", "manifest.inputs.whisper"),
    modelPath: stringField(source, "modelPath", "manifest.inputs.whisper"),
    language: optionalStringField(source, "language"),
    role,
  };
}

function parseInputs(source: JsonObject): VideoProjectInputs {
  const transcript = parseTranscriptInput(objectField(source, "transcript", "manifest.inputs"));
  const recordedMedia = optionalObjectField(source, "recordedMedia");
  const whisper = optionalObjectField(source, "whisper");
  return {
    transcript,
    recordedMedia: recordedMedia ? parseRecordedMediaInput(recordedMedia) : undefined,
    whisper: whisper ? parseWhisperInput(whisper) : undefined,
  };
}

function parseProject(source: JsonObject): VideoProjectIdentity {
  return {
    id: stringField(source, "id", "manifest.project"),
    title: stringField(source, "title", "manifest.project"),
    language: stringField(source, "language", "manifest.project"),
    renderTarget: stringField(source, "renderTarget", "manifest.project"),
    aspectRatio: parseAspectRatio(
      stringField(source, "aspectRatio", "manifest.project"),
      "manifest.project.aspectRatio",
    ),
    fps: numberField(source, "fps", "manifest.project"),
  };
}

function parseVisualContext(source: JsonObject): VisualContextConfig {
  return {
    provider: parseVisualContextProvider(
      stringField(source, "provider", "manifest.visualContext"),
      "manifest.visualContext.provider",
    ),
    rule: stringField(source, "rule", "manifest.visualContext"),
    seqFramesPath: optionalStringField(source, "seqFramesPath"),
    seqDataPath: optionalStringField(source, "seqDataPath"),
  };
}

function parseWorkflow(source: JsonObject): WorkflowConfig {
  const bottlenecks = arrayField(source, "bottlenecks", "manifest.workflow")
    .filter(isObject)
    .map((entry, index) => ({
      id: stringField(entry, "id", `manifest.workflow.bottlenecks[${index}]`),
      status: parseBottleneckStatus(
        stringField(entry, "status", `manifest.workflow.bottlenecks[${index}]`),
        `manifest.workflow.bottlenecks[${index}].status`,
      ),
      reason: stringField(entry, "reason", `manifest.workflow.bottlenecks[${index}]`),
      nextAction: stringField(entry, "nextAction", `manifest.workflow.bottlenecks[${index}]`),
    }));

  return {
    editingModel: stringField(source, "editingModel", "manifest.workflow"),
    captionStrategy: stringField(source, "captionStrategy", "manifest.workflow"),
    bottlenecks,
  };
}

function parseFrameSpan(source: JsonObject): FrameSpan {
  const first = numberField(source, "first", "frameSpan");
  const last = numberField(source, "last", "frameSpan");
  if (!Number.isInteger(first) || !Number.isInteger(last) || first > last) {
    throw new Error(`Invalid frameSpan ${first}..${last}`);
  }
  return { first, last };
}

function parseScene(source: JsonObject, index: number): SceneMapEntry {
  const context = `manifest.sceneMap[${index}]`;
  const timeline = objectField(source, "timeline", context);
  const visualContext = optionalObjectField(source, "visualContext");
  const frameSpanSource = visualContext ? optionalObjectField(visualContext, "frameSpan") : null;

  return {
    id: stringField(source, "id", context),
    label: stringField(source, "label", context),
    timeline: {
      start: stringField(timeline, "start", `${context}.timeline`),
      end: stringField(timeline, "end", `${context}.timeline`),
    },
    visualContext: visualContext
      ? {
          frameSpan: frameSpanSource ? parseFrameSpan(frameSpanSource) : undefined,
          manualRefs: stringArray(visualContext.manualRefs),
        }
      : undefined,
    semanticGoal: stringField(source, "semanticGoal", context),
    captionPolicy: stringField(source, "captionPolicy", context),
    motionDirectives: stringArray(source.motionDirectives),
    bottleneckNotes: stringArray(source.bottleneckNotes),
  };
}

function parseManifest(filePath: string): VideoProjectManifest {
  const manifest = readJson(filePath);
  const schemaVersion = stringField(manifest, "schemaVersion", "manifest");
  if (schemaVersion !== "hyperframes-video-project.v0") {
    throw new Error(`Unsupported manifest schemaVersion: ${schemaVersion}`);
  }

  return {
    schemaVersion,
    project: parseProject(objectField(manifest, "project", "manifest")),
    requirements: parseRequirements(manifest),
    inputs: parseInputs(objectField(manifest, "inputs", "manifest")),
    visualContext: parseVisualContext(objectField(manifest, "visualContext", "manifest")),
    workflow: parseWorkflow(objectField(manifest, "workflow", "manifest")),
    sceneMap: arrayField(manifest, "sceneMap", "manifest")
      .filter(isObject)
      .map((scene, index) => parseScene(scene, index)),
  };
}

function msFromSrt(value: string): number {
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(value);
  if (!match) throw new Error(`Invalid SRT time: ${value}`);
  const [, hh, mm, ss, ms] = match;
  return Number(hh) * 3_600_000 + Number(mm) * 60_000 + Number(ss) * 1_000 + Number(ms);
}

function seconds(value: number): number {
  return Number((value / 1_000).toFixed(3));
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Number((numerator / denominator).toFixed(3));
}

function formatSrtLike(ms: number): string {
  const wholeSeconds = Math.floor(ms / 1_000);
  const milli = String(ms % 1_000).padStart(3, "0");
  const hh = String(Math.floor(wholeSeconds / 3_600)).padStart(2, "0");
  const mm = String(Math.floor((wholeSeconds % 3_600) / 60)).padStart(2, "0");
  const ss = String(wholeSeconds % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss},${milli}`;
}

function parseSrt(filePath: string): readonly TranscriptCue[] {
  const raw = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return raw
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const index = Number(lines[0]);
      const timing = lines[1] ?? "";
      const [start, end] = timing.split(/\s+-->\s+/);
      if (!Number.isInteger(index) || !start || !end) {
        throw new Error(`Invalid SRT block: ${block}`);
      }
      return {
        index,
        start,
        end,
        startMs: msFromSrt(start),
        endMs: msFromSrt(end),
        text: lines.slice(2).join(" "),
      };
    });
}

function resolveProjectPath(projectFile: string, candidate: string): string {
  if (path.isAbsolute(candidate)) return candidate;
  return path.resolve(path.dirname(projectFile), candidate);
}

function cleanRef(ref: string): string {
  return ref.replace(/^!/, "").replace(/:hl$/, "");
}

function unique(items: readonly string[]): readonly string[] {
  return [...new Set(items)];
}

function labelFromFormula(
  formula: JsonObject,
): readonly [string, string | null, string | null] | null {
  const label = optionalStringField(formula, "label") ?? optionalStringField(formula, "id");
  if (!label) return null;
  return [
    label,
    optionalStringField(formula, "latex") ?? null,
    optionalStringField(formula, "interpretation") ?? null,
  ];
}

function buildLabelMap(seqData: JsonObject | null): Map<string, string> {
  const labels = new Map<string, string>();
  if (!seqData) return labels;

  for (const step of optionalArrayField(seqData, "steps")) {
    if (!isObject(step)) continue;

    for (const atom of optionalArrayField(step, "atoms")) {
      if (isString(atom)) {
        labels.set(atom, atom);
      }
      if (!isObject(atom)) continue;
      const id = optionalStringField(atom, "id") ?? optionalStringField(atom, "label");
      if (!id) continue;
      labels.set(
        id,
        optionalStringField(atom, "latex") ??
          optionalStringField(atom, "formula") ??
          optionalStringField(atom, "text") ??
          optionalStringField(atom, "content") ??
          id,
      );
    }

    for (const formula of optionalArrayField(step, "formulas")) {
      if (!isObject(formula)) continue;
      const label = labelFromFormula(formula);
      if (!label) continue;
      const [id, latex, interpretation] = label;
      if (latex) labels.set(id, latex);
      if (interpretation) labels.set(`${id}:interp`, interpretation);
    }
  }

  return labels;
}

function stringsAtIndex(source: JsonObject | null, key: string, index: number): readonly string[] {
  if (!source) return [];
  const table = source[key];
  const row = Array.isArray(table)
    ? table[index]
    : isObject(table)
      ? table[String(index)]
      : undefined;
  return stringArray(row).map(cleanRef);
}

function frameSpanFromScene(scene: SceneMapEntry): FrameSpan | null {
  return scene.visualContext?.frameSpan ?? null;
}

function maxNumericKey(value: unknown): number {
  if (!isObject(value)) return -1;
  return Object.keys(value).reduce((max, key) => {
    const numeric = Number(key);
    if (!Number.isInteger(numeric)) return max;
    return Math.max(max, numeric);
  }, -1);
}

function visualContextFrameCount(seqFrames: JsonObject | null): number {
  if (!seqFrames) return 0;
  const references = optionalObjectField(seqFrames, "references");
  const visual = optionalObjectField(seqFrames, "visual");
  const maxIndex = Math.max(
    maxNumericKey(references?.source),
    maxNumericKey(references?.formulaRefs),
    maxNumericKey(references?.conditionHighlight),
    maxNumericKey(visual?.expressionRefs),
  );
  return maxIndex >= 0 ? maxIndex + 1 : 0;
}

function activeRefsForScene(
  seqFrames: JsonObject | null,
  labels: Map<string, string>,
  scene: SceneMapEntry,
): {
  readonly activeRefs: readonly ActiveVisualRef[];
  readonly expressionRefs: readonly string[];
} {
  const frameSpan = frameSpanFromScene(scene);
  if (!seqFrames || !frameSpan) {
    return { activeRefs: [], expressionRefs: [] };
  }

  const references = optionalObjectField(seqFrames, "references");
  const visual = optionalObjectField(seqFrames, "visual");
  const active: string[] = [];
  const expressions: string[] = [];

  for (let index = frameSpan.first; index <= frameSpan.last; index += 1) {
    active.push(...stringsAtIndex(references, "source", index));
    active.push(...stringsAtIndex(references, "formulaRefs", index));
    active.push(...stringsAtIndex(references, "conditionHighlight", index));
    expressions.push(...stringsAtIndex(visual, "expressionRefs", index));
  }

  return {
    activeRefs: unique(active).map((ref) => ({
      ref,
      meaning: labels.get(ref) ?? null,
    })),
    expressionRefs: unique(expressions),
  };
}

function cuesForScene(
  cues: readonly TranscriptCue[],
  startMs: number,
  endMs: number,
): readonly TranscriptCue[] {
  return cues.filter((cue) => cue.endMs > startMs && cue.startMs < endMs);
}

function cueIndexesForScene(
  cues: readonly TranscriptCue[],
  scene: SceneMapEntry,
): readonly number[] {
  const startMs = msFromSrt(scene.timeline.start);
  const endMs = msFromSrt(scene.timeline.end);
  return cuesForScene(cues, startMs, endMs).map((cue) => cue.index);
}

function sceneDurationMs(scene: SceneMapEntry): number {
  return Math.max(0, msFromSrt(scene.timeline.end) - msFromSrt(scene.timeline.start));
}

function buildDiagnostics(
  cues: readonly TranscriptCue[],
  scenes: readonly SceneMapEntry[],
  bottlenecks: readonly WorkflowBottleneck[],
): PlanDiagnostics {
  const coverage = new Map<number, number>();
  for (const scene of scenes) {
    for (const cueIndex of cueIndexesForScene(cues, scene)) {
      coverage.set(cueIndex, (coverage.get(cueIndex) ?? 0) + 1);
    }
  }

  const uncoveredCueIndexes = cues
    .filter((cue) => !coverage.has(cue.index))
    .map((cue) => cue.index);
  const duplicatedCueIndexes = [...coverage.entries()]
    .filter(([, count]) => count > 1)
    .map(([cueIndex]) => cueIndex);
  const totalSceneMs = scenes.reduce((total, scene) => total + sceneDurationMs(scene), 0);
  const transcriptDurationSeconds = seconds(cues[cues.length - 1]?.endMs ?? 0);
  const totalSceneSeconds = seconds(totalSceneMs);

  return {
    cueCoverage: {
      coveredCueCount: cues.length - uncoveredCueIndexes.length,
      uncoveredCueCount: uncoveredCueIndexes.length,
      duplicatedCueCount: duplicatedCueIndexes.length,
      uncoveredCueIndexSample: uncoveredCueIndexes.slice(0, 20),
      duplicatedCueIndexSample: duplicatedCueIndexes.slice(0, 20),
    },
    sceneTiming: {
      totalSceneSeconds,
      transcriptDurationSeconds,
      sceneCoverageRatio: ratio(totalSceneSeconds, transcriptDurationSeconds),
    },
    activeBottleneckIds: bottlenecks
      .filter((bottleneck) => bottleneck.status === "active" || bottleneck.status === "blocked")
      .map((bottleneck) => bottleneck.id),
  };
}

function buildScenePlan(
  cues: readonly TranscriptCue[],
  seqFrames: JsonObject | null,
  labels: Map<string, string>,
  scene: SceneMapEntry,
): ScenePlan {
  const startMs = msFromSrt(scene.timeline.start);
  const endMs = msFromSrt(scene.timeline.end);
  const sceneCues = cuesForScene(cues, startMs, endMs);
  const refs = activeRefsForScene(seqFrames, labels, scene);
  const transcriptSample = sceneCues
    .map((cue) => cue.text)
    .join(" ")
    .slice(0, 520);
  const firstCue = sceneCues[0] ?? null;
  const lastCue = sceneCues[sceneCues.length - 1] ?? null;

  return {
    id: scene.id,
    label: scene.label,
    time: {
      start: formatSrtLike(startMs),
      end: formatSrtLike(endMs),
      durationSeconds: seconds(endMs - startMs),
    },
    cueRange: {
      first: firstCue ? firstCue.index : null,
      last: lastCue ? lastCue.index : null,
      count: sceneCues.length,
    },
    visualContext: {
      frameSpan: frameSpanFromScene(scene),
      activeRefs: refs.activeRefs,
      expressionRefs: refs.expressionRefs,
      manualRefs: scene.visualContext?.manualRefs ?? [],
    },
    transcriptSample,
    semanticGoal: scene.semanticGoal,
    captionPolicy: scene.captionPolicy,
    motionDirectives: scene.motionDirectives,
    bottleneckNotes: scene.bottleneckNotes,
  };
}

function loadTranscript(
  projectFile: string,
  input: TranscriptInput,
): {
  readonly path: string;
  readonly cues: readonly TranscriptCue[];
} {
  if (input.kind !== "srt") {
    throw new Error(
      `Transcript kind "${input.kind}" is declared but only SRT import is implemented in this framework slice. Run Whisper first and point transcript.path at the generated SRT.`,
    );
  }

  const srtPath = resolveProjectPath(projectFile, input.path);
  return {
    path: srtPath,
    cues: parseSrt(srtPath),
  };
}

function loadVisualContext(
  projectFile: string,
  config: VisualContextConfig,
): {
  readonly seqFrames: JsonObject | null;
  readonly seqData: JsonObject | null;
} {
  if (config.provider !== "palantir-math-sequencer") {
    return { seqFrames: null, seqData: null };
  }
  if (!config.seqFramesPath || !config.seqDataPath) {
    throw new Error(
      "palantir-math-sequencer visual context requires seqFramesPath and seqDataPath",
    );
  }

  return {
    seqFrames: readJson(resolveProjectPath(projectFile, config.seqFramesPath)),
    seqData: readJson(resolveProjectPath(projectFile, config.seqDataPath)),
  };
}

function buildPlan(projectFile: string, manifest: VideoProjectManifest): VideoProjectPlan {
  const transcript = loadTranscript(projectFile, manifest.inputs.transcript);
  const visualContext = loadVisualContext(projectFile, manifest.visualContext);
  const labels = buildLabelMap(visualContext.seqData);
  const scenePlans = manifest.sceneMap.map((scene) =>
    buildScenePlan(transcript.cues, visualContext.seqFrames, labels, scene),
  );
  const durationMs = transcript.cues[transcript.cues.length - 1]?.endMs ?? 0;

  return {
    schemaVersion: "hyperframes-video-project-plan.v0",
    project: manifest.project,
    sourceAuthority: {
      primaryTimeline: manifest.inputs.transcript.authority,
      transcriptPath: transcript.path,
      whisperRole: manifest.inputs.whisper?.role ?? "not-configured",
      visualContextProvider: manifest.visualContext.provider,
      visualContextRule: manifest.visualContext.rule,
    },
    promptInterpretation: manifest.requirements,
    metrics: {
      cueCount: transcript.cues.length,
      durationSeconds: seconds(durationMs),
      plannedSceneCount: scenePlans.length,
      visualContextFrameCount: visualContextFrameCount(visualContext.seqFrames),
    },
    diagnostics: buildDiagnostics(
      transcript.cues,
      manifest.sceneMap,
      manifest.workflow.bottlenecks,
    ),
    bottlenecks: manifest.workflow.bottlenecks,
    scenes: scenePlans,
    nextLoop: [
      "Review generated scene boundaries against the final user script.",
      "Treat uncovered cues as blocking and duplicated cue indexes as scene-boundary review points.",
      "Promote accepted scene plans into a Hyperframes composition manifest.",
      "Generate layout-first composition HTML with deterministic assets only.",
      "Run npx hyperframes lint and npx hyperframes validate on the generated composition.",
      "Backpropagate caption, timing, or visual-context failures into project.json before editing animation code.",
    ],
  };
}

function formatOutput(filePath: string): void {
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
  const projectFile = path.resolve(args.project);
  const outPath = path.resolve(
    args.out ?? path.join(path.dirname(projectFile), "plan", "video-project-plan.json"),
  );
  const manifest = parseManifest(projectFile);
  const plan = buildPlan(projectFile, manifest);

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  formatOutput(outPath);
  console.log(outPath);
}

main();
