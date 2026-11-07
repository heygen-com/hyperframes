import {
  formatPreviewProxyBox,
  PREVIEW_PROXY_BOX_PARAM,
  PREVIEW_PROXY_LIGHT_PARAM,
  PREVIEW_PROXY_SEEK_PARAM,
  type PreviewProxyBox,
} from "@hyperframes/core/preview-quality";
import { studioApiFetch } from "../../utils/studioApiFetch";

/** Prepared files are decoder inputs; the authored video element keeps its source. */
export function createSeekPreviewSources() {
  const ready = new Map<string, string>();
  const requested = new Set<string>();
  const controller = new AbortController();
  const key = (source: string, box: PreviewProxyBox) => `${source}|${formatPreviewProxyBox(box)}`;
  return {
    get(source: string, box: PreviewProxyBox) {
      return ready.get(key(source, box)) ?? source;
    },
    prepare(source: string, box: PreviewProxyBox) {
      if (controller.signal.aborted) return;
      const id = key(source, box);
      const url = new URL(source, location.href);
      if (
        ready.has(id) ||
        requested.has(id) ||
        url.origin !== location.origin ||
        url.searchParams.has("hf-proxy")
      )
        return;
      requested.add(id);
      url.searchParams.set("hf-proxy", "auto");
      url.searchParams.set(PREVIEW_PROXY_LIGHT_PARAM, "1");
      url.searchParams.set(PREVIEW_PROXY_SEEK_PARAM, "1");
      url.searchParams.set(PREVIEW_PROXY_BOX_PARAM, formatPreviewProxyBox(box));
      void (async () => {
        while (!controller.signal.aborted) {
          const response = await studioApiFetch(url, {
            headers: { Range: "bytes=0-0", "X-HF-Proxy-Priority": "0" },
            signal: controller.signal,
          });
          void response.body?.cancel().catch(() => {});
          if (controller.signal.aborted) return;
          if (response.ok && response.status !== 202) {
            ready.set(id, url.href);
            return;
          }
          if (response.status !== 202 && response.status !== 503) return;
          const delay = Math.min(30, Math.max(1, Number(response.headers.get("Retry-After")) || 2));
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              controller.signal.removeEventListener("abort", done);
              resolve();
            };
            const timer = setTimeout(done, delay * 1000);
            controller.signal.addEventListener("abort", done, { once: true });
          });
        }
      })()
        .catch(() => {})
        .finally(() => requested.delete(id));
    },
    dispose() {
      controller.abort();
      ready.clear();
      requested.clear();
    },
  };
}
