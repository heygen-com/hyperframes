import { createHash } from "node:crypto";
import { closeSync, createReadStream, fstatSync, openSync, readFileSync } from "node:fs";
import { stat as statAsync } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { formatPreviewProxyBox, type PreviewProxyBox } from "@hyperframes/core";
import { replaceFileAtomically } from "@hyperframes/core/atomic-file";
import { isProjectCacheFileAsync, readProjectCacheFileAsync } from "./safePath.js";

const SMALL_FILE_BYTES = 16 * 1024 * 1024;
const COPY_NAME = /^[0-9a-f]{64}\.(?:mp4|webm)$/;

function digest(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function boxPart(box: PreviewProxyBox | undefined): string {
  return box ? formatPreviewProxyBox(box) : "";
}

/** Where a source sits and when it last changed: a hit needs no reading of the file. */
export async function fastCopyKey(
  sourcePath: string,
  version: string,
  variant: string,
  box: PreviewProxyBox | undefined,
): Promise<string> {
  const stat = await statAsync(sourcePath);
  return digest(
    sourcePath,
    String(stat.mtimeMs),
    String(stat.size),
    version,
    variant,
    boxPart(box),
  );
}

/** What a source holds, whole file: a copied project or a re-saved file with the same bytes finds its copy. */
export async function contentCopyKey(
  sourcePath: string,
  version: string,
  variant: string,
  box: PreviewProxyBox | undefined,
  signal: AbortSignal,
): Promise<string> {
  const hash = createHash("sha256");
  const fd = openSync(sourcePath, "r");
  try {
    if (fstatSync(fd).size <= SMALL_FILE_BYTES) hash.update(readFileSync(fd));
    else
      for await (const chunk of createReadStream(sourcePath, { fd, autoClose: false, signal }))
        hash.update(chunk);
  } finally {
    closeSync(fd);
  }
  return digest(hash.digest("hex"), version, variant, boxPart(box));
}

export function sourceSizeBytes(sourcePath: string): number | undefined {
  try {
    const fd = openSync(sourcePath, "r");
    try {
      return fstatSync(fd).size;
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

export function fastIndexPath(cachePath: string): string {
  return join(dirname(cachePath), `.fast-${basename(cachePath, extname(cachePath))}`);
}

export function contentIndexPath(cacheDir: string, contentKey: string): string {
  return join(cacheDir, `.content-${contentKey}`);
}

/** The copy an index file names, when it is a plain file in the same folder; a link at either is a miss. */
export async function readCopyIndex(projectDir: string, indexPath: string): Promise<string | null> {
  const bytes = await readProjectCacheFileAsync(projectDir, indexPath, 256);
  const name = bytes?.toString("utf8").trim() ?? "";
  const target = join(dirname(indexPath), name);
  return COPY_NAME.test(name) && (await isProjectCacheFileAsync(projectDir, target))
    ? target
    : null;
}

export function writeCopyIndex(indexPath: string, copyPath: string): void {
  replaceFileAtomically(indexPath, basename(copyPath), 0o644);
}
