import type { HTTPResponse } from "puppeteer-core";
import type { DiscoveredLottie } from "./mediaCapture.js";
import { safeFetch } from "./assetDownloader.js";
import { readBoundedResponse, type DownloadByteBudget } from "./readBoundedResponse.js";
import { validLottieJson } from "./lottieValidation.js";
import { CAPTURE_USER_AGENT } from "./userAgent.js";

/** Puppeteer exposes a fully buffered body; inspect candidates through a bounded stream instead. */
export async function discoverLottieResponse(
  response: Pick<HTTPResponse, "url" | "headers">,
  budget: DownloadByteBudget,
  timeoutMs = 10_000,
): Promise<DiscoveredLottie | null> {
  const url = response.url();
  const pathname = new URL(url).pathname;
  if (pathname.endsWith(".lottie")) return { url };
  const contentType = response.headers()["content-type"] ?? "";
  if (!pathname.endsWith(".json") && !/application\/json|text\/plain/i.test(contentType))
    return null;
  if (budget.remainingBytes <= 0) return null;
  const fetched = await safeFetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": CAPTURE_USER_AGENT },
  });
  if (!fetched?.ok) return null;
  const bytes = await readBoundedResponse(fetched, 5_000_000, budget);
  if (!bytes) return null;
  const source = bytes.toString("utf8");
  if (!validLottieJson(source)) return null;
  const data: unknown = JSON.parse(source);
  if (!hasDiscoveryFields(data)) return null;
  return { url, data, dataBudget: budget };
}

function hasDiscoveryFields(data: unknown): data is Record<string, unknown> {
  if (data === null || typeof data !== "object") return false;
  return ["v", "ip", "op", "layers", "w", "h", "fr"].every((key) => key in data);
}

interface Candidate {
  url: string;
  contentType: string;
  priority: number;
}

/** Own discovery work: response events only enqueue metadata, and run() joins every fetch. */
export class LottieDiscovery {
  private candidates = new Map<string, Candidate>();
  private closed = false;

  collect(response: Pick<HTTPResponse, "url" | "headers">): void {
    if (this.closed) return;
    const url = response.url();
    if (this.candidates.has(url)) return;
    const contentType = response.headers()["content-type"] ?? "";
    const priority = candidatePriority(url, contentType);
    if (priority === null) return;
    if (this.candidates.size >= 32) {
      const worst = [...this.candidates.values()]
        .sort((a, b) => b.priority - a.priority)
        .find((candidate) => candidate.priority > priority);
      if (!worst) return;
      this.candidates.delete(worst.url);
    }
    this.candidates.set(url, { url, contentType, priority });
  }

  async run(
    sharedBudget: DownloadByteBudget,
    remainingMs: () => number,
  ): Promise<DiscoveredLottie[]> {
    if (this.closed) return [];
    this.closed = true;
    const candidates = [...this.candidates.values()].sort((a, b) => a.priority - b.priority);
    this.candidates.clear();
    const deadline = Date.now() + Math.min(10_000, remainingMs());
    const budget = { remainingBytes: Math.min(20 * 1024 * 1024, sharedBudget.remainingBytes) };
    const found: DiscoveredLottie[] = [];
    for (const candidate of candidates) {
      const timeout = Math.floor(Math.min(deadline - Date.now(), remainingMs()));
      if (timeout <= 0 || budget.remainingBytes <= 0 || found.length >= 10) break;
      const before = budget.remainingBytes;
      try {
        const result = await discoverLottieResponse(
          { url: () => candidate.url, headers: () => ({ "content-type": candidate.contentType }) },
          budget,
          timeout,
        );
        if (result) found.push({ ...result, dataBudget: sharedBudget });
      } catch {
        /* unavailable candidate */
      } finally {
        sharedBudget.remainingBytes -= before - budget.remainingBytes;
      }
    }
    return found;
  }
}

function candidatePriority(url: string, contentType: string): number | null {
  const path = new URL(url).pathname;
  if (path.endsWith(".lottie")) return 0;
  if (path.endsWith(".json")) return 1;
  return /application\/json|text\/plain/i.test(contentType) ? 2 : null;
}
