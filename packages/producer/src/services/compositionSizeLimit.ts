import { statSync } from "node:fs";

/**
 * The largest entry or sub-composition HTML file a render compiles. Compiling and probing a page
 * runs on the render server's main thread, and their cost grows with the page's size, so one huge
 * page would hold up every other render in the same process.
 */
export const MAX_COMPOSITION_HTML_BYTES = 16 * 1024 * 1024;

const COMPOSITION_TOO_LARGE = "COMPOSITION_TOO_LARGE" as const;

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

class CompositionTooLargeError extends Error {
  readonly code = COMPOSITION_TOO_LARGE;
  // The producer server reads these off the error for the wire envelope.
  readonly owner = "user" as const;
  readonly retryable = false as const;
  readonly publicMetadata: Readonly<{ bytes: number; limitBytes: number }>;

  constructor(file: string, bytes: number) {
    super(
      `Composition file "${file}" is ${megabytes(bytes)}, over the ` +
        `${megabytes(MAX_COMPOSITION_HTML_BYTES)} limit for one composition HTML file. ` +
        "Keep large data such as images, fonts and JSON in separate asset files and reference " +
        "them by path instead of inlining them.",
    );
    this.name = "CompositionTooLargeError";
    this.publicMetadata = { bytes, limitBytes: MAX_COMPOSITION_HTML_BYTES };
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
  if (bytes > MAX_COMPOSITION_HTML_BYTES) throw new CompositionTooLargeError(file, bytes);
}
