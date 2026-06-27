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
  status: "rendering" | "complete" | "failed";
  progress: number;
  stage?: string;
  outputPath: string;
  error?: string;
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
