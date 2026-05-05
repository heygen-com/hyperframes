export type TranscriptSourceKind = "script" | "srt" | "mp4";

export type VisualContextProviderKind = "none" | "palantir-math-sequencer" | "manual";

export type RenderAspectRatio = "16:9" | "9:16" | "1:1";

export interface VideoProjectManifest {
  readonly schemaVersion: "hyperframes-video-project.v0";
  readonly project: VideoProjectIdentity;
  readonly requirements: readonly RequirementSource[];
  readonly inputs: VideoProjectInputs;
  readonly visualContext: VisualContextConfig;
  readonly workflow: WorkflowConfig;
  readonly sceneMap: readonly SceneMapEntry[];
}

export interface VideoProjectIdentity {
  readonly id: string;
  readonly title: string;
  readonly language: string;
  readonly renderTarget: string;
  readonly aspectRatio: RenderAspectRatio;
  readonly fps: number;
}

export interface RequirementSource {
  readonly source: string;
  readonly meaning: string;
}

export interface VideoProjectInputs {
  readonly transcript: TranscriptInput;
  readonly recordedMedia?: RecordedMediaInput;
  readonly whisper?: WhisperRuntimeInput;
}

export interface TranscriptInput {
  readonly kind: TranscriptSourceKind;
  readonly path: string;
  readonly authority: string;
}

export interface RecordedMediaInput {
  readonly kind: "mp4";
  readonly path?: string;
  readonly status: "pending-user-provided" | "available";
}

export interface WhisperRuntimeInput {
  readonly binaryPath: string;
  readonly modelPath: string;
  readonly language?: string;
  readonly role: "caption-generation" | "timing-validation" | "disabled";
}

export interface VisualContextConfig {
  readonly provider: VisualContextProviderKind;
  readonly rule: string;
  readonly seqFramesPath?: string;
  readonly seqDataPath?: string;
}

export interface WorkflowConfig {
  readonly editingModel: string;
  readonly captionStrategy: string;
  readonly bottlenecks: readonly WorkflowBottleneck[];
}

export interface WorkflowBottleneck {
  readonly id: string;
  readonly status: "active" | "ready" | "blocked" | "deferred";
  readonly reason: string;
  readonly nextAction: string;
}

export interface SceneMapEntry {
  readonly id: string;
  readonly label: string;
  readonly timeline: TimeSpan;
  readonly semanticGoal: string;
  readonly visualContext?: SceneVisualContext;
  readonly captionPolicy: string;
  readonly motionDirectives: readonly string[];
  readonly bottleneckNotes: readonly string[];
}

export interface TimeSpan {
  readonly start: string;
  readonly end: string;
}

export interface SceneVisualContext {
  readonly frameSpan?: FrameSpan;
  readonly manualRefs?: readonly string[];
}

export interface FrameSpan {
  readonly first: number;
  readonly last: number;
}

export interface TranscriptCue {
  readonly index: number;
  readonly start: string;
  readonly end: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

export interface VideoProjectPlan {
  readonly schemaVersion: "hyperframes-video-project-plan.v0";
  readonly project: VideoProjectIdentity;
  readonly sourceAuthority: SourceAuthoritySummary;
  readonly promptInterpretation: readonly RequirementSource[];
  readonly metrics: PlanMetrics;
  readonly diagnostics: PlanDiagnostics;
  readonly bottlenecks: readonly WorkflowBottleneck[];
  readonly scenes: readonly ScenePlan[];
  readonly nextLoop: readonly string[];
}

export interface SourceAuthoritySummary {
  readonly primaryTimeline: string;
  readonly transcriptPath: string;
  readonly whisperRole: string;
  readonly visualContextProvider: VisualContextProviderKind;
  readonly visualContextRule: string;
}

export interface PlanMetrics {
  readonly cueCount: number;
  readonly durationSeconds: number;
  readonly plannedSceneCount: number;
  readonly visualContextFrameCount: number;
}

export interface PlanDiagnostics {
  readonly cueCoverage: CueCoverageDiagnostics;
  readonly sceneTiming: SceneTimingDiagnostics;
  readonly activeBottleneckIds: readonly string[];
}

export interface CueCoverageDiagnostics {
  readonly coveredCueCount: number;
  readonly uncoveredCueCount: number;
  readonly duplicatedCueCount: number;
  readonly uncoveredCueIndexSample: readonly number[];
  readonly duplicatedCueIndexSample: readonly number[];
}

export interface SceneTimingDiagnostics {
  readonly totalSceneSeconds: number;
  readonly transcriptDurationSeconds: number;
  readonly sceneCoverageRatio: number;
}

export interface ScenePlan {
  readonly id: string;
  readonly label: string;
  readonly time: TimeSpan & {
    readonly durationSeconds: number;
  };
  readonly cueRange: {
    readonly first: number | null;
    readonly last: number | null;
    readonly count: number;
  };
  readonly visualContext: {
    readonly frameSpan: FrameSpan | null;
    readonly activeRefs: readonly ActiveVisualRef[];
    readonly expressionRefs: readonly string[];
    readonly manualRefs: readonly string[];
  };
  readonly transcriptSample: string;
  readonly semanticGoal: string;
  readonly captionPolicy: string;
  readonly motionDirectives: readonly string[];
  readonly bottleneckNotes: readonly string[];
}

export interface ActiveVisualRef {
  readonly ref: string;
  readonly meaning: string | null;
}
