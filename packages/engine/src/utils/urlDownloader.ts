import { createWriteStream, existsSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { join, extname } from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";

const downloadPathCache = new Map<string, string>();
const inFlightDownloads = new Map<string, Promise<string>>();

function getFilenameFromUrl(url: string): string {
  const hash = createHash("md5").update(url).digest("hex").slice(0, 12);
  const urlObj = new URL(url);
  const ext = extname(urlObj.pathname) || ".mp4";
  return `download_${hash}${ext}`;
}

export async function downloadToTemp(
  url: string,
  destDir: string,
  timeoutMs: number = 300000,
): Promise<string> {
  const cachedPath = downloadPathCache.get(url);
  if (cachedPath && existsSync(cachedPath)) {
    return cachedPath;
  }
  const inFlight = inFlightDownloads.get(url);
  if (inFlight) {
    return inFlight;
  }

  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  const filename = getFilenameFromUrl(url);
  const localPath = join(destDir, filename);

  if (existsSync(localPath)) {
    downloadPathCache.set(url, localPath);
    return localPath;
  }

  const downloadPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("Response body is empty");
      }

      const fileStream = createWriteStream(localPath);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const readableStream = Readable.fromWeb(response.body as any);
      await finished(readableStream.pipe(fileStream));

      downloadPathCache.set(url, localPath);
      return localPath;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("aborted")) {
        throw new Error(`[URLDownloader] Download timeout after ${timeoutMs / 1000}s: ${url}`);
      }
      throw new Error(`[URLDownloader] Download failed: ${message}`);
    } finally {
      inFlightDownloads.delete(url);
    }
  })();
  inFlightDownloads.set(url, downloadPromise);
  return downloadPromise;
}

export function isHttpUrl(path: string): boolean {
  return path.startsWith("http://") || path.startsWith("https://");
}
