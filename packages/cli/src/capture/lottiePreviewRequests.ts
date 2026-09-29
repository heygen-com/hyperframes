import type { Page } from "puppeteer-core";
import { isPrivateUrl } from "./assetDownloader.js";

export const LOTTIE_RUNTIME_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js";

/** Apply capture's URL policy to each preview request, including redirect targets. */
export function allowedLottieRequest(url: string, resourceType: string): boolean {
  if (url === LOTTIE_RUNTIME_URL) return true;
  if (!["image", "font", "stylesheet"].includes(resourceType)) return false;
  if (url.startsWith("data:") || url.startsWith("blob:")) return true;
  return !isPrivateUrl(url);
}

export async function guardLottiePreviewRequests(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.isInterceptResolutionHandled()) return;
    const action = allowedLottieRequest(request.url(), request.resourceType())
      ? request.continue()
      : request.abort("blockedbyclient");
    void action.catch(() => {});
  });
}
