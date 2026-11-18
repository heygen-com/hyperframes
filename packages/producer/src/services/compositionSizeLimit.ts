import { statSync } from "node:fs";

/**
 * The largest entry or sub-composition HTML file a render compiles. Compiling and probing a page
 * runs on the render server's main thread, and their cost grows with the page's size, so one huge
 * page would hold up every other render in the same process.
 */
export const MAX_COMPOSITION_HTML_BYTES = 16 * 1024 * 1024;

const COMPOSITION_TOO_LARGE = "COMPOSITION_TOO_LARGE" as const;

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * What one render may inline across every sub-composition mount. Each file is checked on its own
 * above, but a few small files that mount each other many times assemble a page far larger.
 */
export const MAX_EXPANDED_COMPOSITION_BYTES = 2 * MAX_COMPOSITION_HTML_BYTES;
const MAX_COMPOSITION_MOUNTS = 10_000;

class CompositionTooLargeError extends Error {
  readonly code = COMPOSITION_TOO_LARGE;
  // The producer server reads these off the error for the wire envelope.
  readonly owner = "user" as const;
  readonly retryable = false as const;

  constructor(
    message: string,
    readonly publicMetadata: Readonly<{
      bytes: number;
      limitBytes: number;
      mounts?: number;
      exceeded?: "bytes" | "mounts" | "generated";
    }>,
  ) {
    super(message);
    this.name = "CompositionTooLargeError";
  }
}

const fileTooLarge = (file: string, bytes: number) =>
  new CompositionTooLargeError(
    `Composition file "${file}" is ${megabytes(bytes)}, over the ` +
      `${megabytes(MAX_COMPOSITION_HTML_BYTES)} limit for one composition HTML file. ` +
      "Keep large data such as images, fonts and JSON in separate asset files and reference " +
      "them by path instead of inlining them.",
    { bytes, limitBytes: MAX_COMPOSITION_HTML_BYTES },
  );

const limitText = `One render generates at most ${megabytes(MAX_EXPANDED_COMPOSITION_BYTES)}`;

export const REMOTE_SCRIPTS = "remote scripts";
export const REMOTE_STYLESHEETS = "remote stylesheets";

function generatedTooLarge(file: string, bytes: number): string {
  if (file === "composition variables") {
    return (
      `Composition variable styles add up to ${megabytes(bytes)}. ${limitText}. ` +
      "Shorten the variable values or declare them on fewer elements."
    );
  }
  if (file === "variable media sources") {
    return (
      `Variable-bound media sources add up to ${megabytes(bytes)}. ${limitText}. ` +
      "Use shorter URLs or bind fewer elements."
    );
  }
  if (file === REMOTE_SCRIPTS || file === REMOTE_STYLESHEETS) {
    return (
      `Inlined ${file} add up to ${megabytes(bytes)}. ${limitText}. ` +
      "Bundle scripts and fonts with the project, or link each one once."
    );
  }
  return (
    `Scripts, styles and rebased asset paths generated for compositions, ending at "${file}", add up to ` +
    `${megabytes(bytes)}. One render generates at most ` +
    `${megabytes(MAX_EXPANDED_COMPOSITION_BYTES)} for its mounts. Merge small inline scripts ` +
    "and style rules, keep data-composition-id values short, or mount scenes fewer times."
  );
}

/** Adds up every mount a render inlines, and what it generates for them, and throws past a limit. */
export class CompositionExpansionBudget {
  private bytes = 0;
  private mounts = 0;
  private generated = 0;

  /** `bytes` may be negative when a reserved upper bound is settled to the real size. */
  chargeGenerated(file: string, bytes: number): void {
    this.generated += bytes;
    if (this.generated <= MAX_EXPANDED_COMPOSITION_BYTES) return;
    throw new CompositionTooLargeError(generatedTooLarge(file, this.generated), {
      bytes: this.generated,
      limitBytes: MAX_EXPANDED_COMPOSITION_BYTES,
      exceeded: "generated",
    });
  }

  chargeGeneratedIfItFits(bytes: number): boolean {
    if (this.generated + bytes > MAX_EXPANDED_COMPOSITION_BYTES) return false;
    this.generated += bytes;
    return true;
  }

  charge(file: string, bytes: number): void {
    this.bytes += bytes;
    this.mounts += 1;
    if (this.bytes <= MAX_EXPANDED_COMPOSITION_BYTES && this.mounts <= MAX_COMPOSITION_MOUNTS) {
      return;
    }
    throw new CompositionTooLargeError(
      `Sub-composition mounts, ending at "${file}", add up to ${megabytes(this.bytes)} ` +
        `across ${this.mounts} mounts. One render inlines at most ` +
        `${megabytes(MAX_EXPANDED_COMPOSITION_BYTES)} of composition HTML in at most ` +
        `${MAX_COMPOSITION_MOUNTS} mounts. Mount large or repeated scenes fewer times.`,
      {
        bytes: this.bytes,
        limitBytes: MAX_EXPANDED_COMPOSITION_BYTES,
        mounts: this.mounts,
        exceeded: this.mounts > MAX_COMPOSITION_MOUNTS ? "mounts" : "bytes",
      },
    );
  }
}

/**
 * Throws {@link CompositionTooLargeError} when `path` is a file over the limit, before anything
 * reads it. A missing path or a folder passes, so the caller's own read reports it as before.
 */
export function assertCompositionFileSize(path: string, file: string): void {
  let bytes: number;
  try {
    const stats = statSync(path);
    if (!stats.isFile()) return;
    bytes = stats.size;
  } catch {
    return;
  }
  if (bytes > MAX_COMPOSITION_HTML_BYTES) throw fileTooLarge(file, bytes);
}
