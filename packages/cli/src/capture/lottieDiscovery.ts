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
): Promise<DiscoveredLottie | null> {
  const url = response.url();
  const pathname = new URL(url).pathname;
  if (pathname.endsWith(".lottie")) return { url };
  const contentType = response.headers()["content-type"] ?? "";
  if (!pathname.endsWith(".json") && !/application\/json|text\/plain/i.test(contentType))
    return null;
  if (budget.remainingBytes <= 0) return null;
  const fetched = await safeFetch(url, {
    signal: AbortSignal.timeout(10_000),
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
