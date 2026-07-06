import type { CanvasResolution } from "@hyperframes/parsers";
import type { RegistryItem } from "@hyperframes/core";

/** Resolved info about a single project. */
export interface ResolvedProject {
  id: string;
  dir: string;
  title?: string;
  sessionId?: string;
}

/** Observable render job state, polled by the SSE progress handler. */
export interface RenderJobState {
  id: string;
  status: "rendering" | "complete" | "failed" | "cancelled";
  progress: number;
  stage?: string;
  outputPath: string;
  error?: string;
  /**
   * Optional abort hook set by the adapter. The cancel route calls this to
   * stop an in-flight render; adapters that can't abort may omit it (the
   * route still marks the job cancelled so the SSE stream terminates).
   */
  cancel?: () => void;
}

export interface MediaProcessingJobState {
  id: string;
  status: "processing" | "complete" | "failed";
  progress: number;
  stage?: string;
  inputAssetPath: string;
  outputAssetPath: string;
  outputPath: string;
  backgroundOutputAssetPath?: string;
  backgroundOutputPath?: string;
  error?: string;
  provider?: string;
  framesProcessed?: number;
  durationSeconds?: number;
  avgMsPerFrame?: number;
}

/** Lint result from the core linter. */
export interface LintResult {
  findings: Array<{
    severity: string;
    message: string;
    file?: string;
    fixHint?: string;
  }>;
}

export interface StudioSelectionTextField {
  key: string;
  label: string;
  value: string;
  tagName: string;
  source: "self" | "child" | "text-node";
}

export interface StudioSelectionSnapshot {
  schemaVersion: 1;
  projectId: string;
  compositionPath: string;
  sourceFile: string;
  currentTime: number;
  target: {
    id?: string | null;
    hfId?: string;
    selector?: string;
    selectorIndex?: number;
  };
  label: string;
  tagName: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  textContent: string | null;
  dataAttributes: Record<string, string>;
  inlineStyles: Record<string, string>;
  computedStyles: Record<string, string>;
  textFields: StudioSelectionTextField[];
  capabilities: Record<string, boolean | string | undefined>;
  thumbnailUrl: string;
}

export interface StudioSelectionResponse {
  selection: StudioSelectionSnapshot | null;
  updatedAt: string | null;
}

/**
 * Adapter interface — injected by each consumer to handle host-specific behavior.
 * The shared API module calls these methods; each host (vite dev, CLI embedded)
 * provides its own implementation.
 */
export interface StudioApiAdapter {
  /** List all available projects. */
  listProjects(): Promise<ResolvedProject[]> | ResolvedProject[];

  /** Resolve a project ID (or session ID) to its directory. Returns null if not found. */
  resolveProject(id: string): Promise<ResolvedProject | null> | ResolvedProject | null;

  /** Bundle a project directory into a single HTML string. Returns null if unavailable. */
  bundle(projectDir: string): Promise<string | null>;

  /** Optional: cached signature for project files that should invalidate preview frame caches. */
  getProjectSignature?: (projectDir: string) => string;

  /** Lint a single HTML string. */
  lint(html: string, opts?: { filePath?: string }): Promise<LintResult> | LintResult;

  /** URL to the hyperframe runtime JS (injected into preview HTML). */
  runtimeUrl: string;

  /**
   * Optional: post-process preview HTML before Studio augments it.
   * Useful when preview must mirror render-time compilation steps.
   */
  transformPreviewHtml?: (opts: {
    html: string;
    project: ResolvedProject;
    activeCompositionPath: string;
  }) => Promise<string> | string;

  /** Directory where render output files are stored. */
  rendersDir(project: ResolvedProject): string;

  /**
   * Start a render job. The adapter owns the async execution and must
   * update the returned RenderJobState object reactively.
   */
  startRender(opts: {
    project: ResolvedProject;
    outputPath: string;
    format: "mp4" | "webm" | "mov";
    /**
     * Frame rate as an exact rational. The HTTP layer (POST
     * `/projects/:id/render`) accepts either a JSON number (integer fps,
     * `30`) or a JSON string (ffmpeg-style rational, `"30000/1001"`); the
     * route normalizes both into `Fps` before invoking the adapter, so
     * adapter implementations only ever see the rational form.
     */
    fps: import("@hyperframes/core").Fps;
    quality: string;
    jobId: string;
    /**
     * Optional output resolution preset. See `resolveDeviceScaleFactor` in
     * the producer for the integer-scale + aspect + HDR constraints.
     */
    outputResolution?: CanvasResolution;
    /** Entry file relative to projectDir (e.g. "compositions/intro.html"). Defaults to index.html. */
    composition?: string;
    /**
     * Telemetry id of the browser user who triggered the render. Lets the
     * adapter attribute the server-emitted render_complete/render_error to
     * that user so the studio render funnel is joinable. Undefined for older
     * clients → falls back to the install's anonymous id.
     */
    distinctId?: string;
  }): RenderJobState;

  startBackgroundRemoval?: (opts: {
    project: ResolvedProject;
    inputPath: string;
    inputAssetPath: string;
    outputPath: string;
    outputAssetPath: string;
    backgroundOutputPath?: string;
    backgroundOutputAssetPath?: string;
    quality: "fast" | "balanced" | "best";
    device?: "auto" | "cpu" | "coreml" | "cuda";
    jobId: string;
  }) => MediaProcessingJobState;

  /** Optional: generate a JPEG thumbnail via Puppeteer or similar. */
  generateThumbnail?: (opts: {
    project: ResolvedProject;
    compPath: string;
    seekTime: number;
    width: number;
    height: number;
    previewUrl: string;
    selector?: string;
    format?: "jpeg" | "png";
    selectorIndex?: number;
  }) => Promise<Buffer | null>;

  /** Optional: resolve session ID to project (multi-project mode). */
  resolveSession?: (sessionId: string) => Promise<{ projectId: string; title: string } | null>;

  /** Optional: list all registry items (blocks + components) for the catalog. */
  listRegistryCatalog?(): Promise<RegistryItem[]>;

  /** Optional: install a registry item into a project directory. */
  installRegistryBlock?(opts: {
    project: ResolvedProject;
    blockName: string;
  }): Promise<{ written: string[]; block: RegistryItem }>;
}
