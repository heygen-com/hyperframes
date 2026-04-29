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

  /** Lint a single HTML string. */
  lint(html: string, opts?: { filePath?: string }): Promise<LintResult> | LintResult;

  /** URL to the hyperframe runtime JS (injected into preview HTML). */
  runtimeUrl: string;

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
    fps: number;
    quality: string;
    jobId: string;
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
  }) => Promise<Buffer | null>;

  /** Optional: resolve session ID to project (multi-project mode). */
  resolveSession?: (sessionId: string) => Promise<{ projectId: string; title: string } | null>;
}
