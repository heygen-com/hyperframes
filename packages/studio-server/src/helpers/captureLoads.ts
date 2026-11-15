import { PREVIEW_PROXY_PRIORITY_HEADER, PREVIEW_PROXY_PROGRESS_HEADER } from "@hyperframes/core";
import { decodeWellFormedEscapes } from "./requestSubPath.js";

/**
 * A sandboxed capture document's CORS-mode loads fail, so the trusted renderer adds CORS headers for
 * its own page: every GET of the project's preview files except a dotfile or dot-folder (`.env`,
 * `.git/`), and the preflight of the runtime's wait for a video's `?hf-proxy=` copy.
 */
// Chrome reports a page's `fetch()`, and its preflight, as `XHR`.
const GRANTED_TYPES = new Set(["Font", "Script", "Stylesheet", "Image", "Media", "Fetch", "XHR"]);

const PROXY_PARAM = "hf-proxy";
const VIDEO_FILE = /\.(mp4|webm|mov|mkv|avi|m4v|mxf|mts|m2ts)$/i;

function capturePreviewPrefix(captureUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(captureUrl);
  } catch {
    return null;
  }
  const path = /^\/api\/projects\/[^/]+\/preview(?=\/|$)/.exec(url.pathname)?.[0];
  return path ? `${url.origin}${path}/` : null;
}

export interface CaptureSandboxOption {
  /**
   * Serve thumbnail capture documents (`?hf-capture`) in an opaque origin. Default off. Turn it on
   * only with a thumbnail renderer that calls `grantCaptureLoads` on each capture page before loading
   * it; without that grant its captures lose fonts, module scripts, nested scenes and video pixels.
   */
  sandboxThumbnailCaptures?: boolean;
}

export interface CaptureLoad {
  url: string;
  method: string;
  resourceType: string;
}

const decodedSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return ".";
  }
};

const isDotPath = (url: URL, prefix: string) => {
  const rest = url.pathname.slice(new URL(prefix).pathname.length);
  return [
    ...rest.split("/").map(decodedSegment),
    ...decodeWellFormedEscapes(rest).split(/[\\/]/),
  ].some((segment) => segment.startsWith("."));
};

export function captureLoadGrant(
  load: CaptureLoad,
  captureUrl: string,
): "read" | "preflight" | null {
  const prefix = capturePreviewPrefix(captureUrl);
  if (!prefix || !load.url.startsWith(prefix)) return null;
  const url = new URL(load.url);
  if (isDotPath(url, prefix) || !GRANTED_TYPES.has(load.resourceType)) return null;
  const proxyWait =
    (load.resourceType === "XHR" || load.resourceType === "Fetch") &&
    url.searchParams.has(PROXY_PARAM) &&
    VIDEO_FILE.test(url.pathname);
  if (load.method === "OPTIONS") return proxyWait ? "preflight" : null;
  return load.method === "GET" ? "read" : null;
}

type Header = { name: string; value: string };

export interface CaptureCdpSession {
  send(method: string, params?: object): Promise<unknown>;
  on(
    event: "Fetch.requestPaused",
    handler: (event: {
      requestId: string;
      request: { url: string; method: string };
      resourceType: string;
      responseStatusCode?: number;
      responseHeaders?: Header[];
    }) => void,
  ): unknown;
}

const OPAQUE_CALLER: Header[] = [
  { name: "Access-Control-Allow-Origin", value: "null" },
  { name: "X-Content-Type-Options", value: "nosniff" },
  {
    name: "Access-Control-Expose-Headers",
    value: `Retry-After, ${PREVIEW_PROXY_PROGRESS_HEADER}, Content-Range`,
  },
];
const PREFLIGHT_ANSWER: Header[] = [
  { name: "Access-Control-Allow-Origin", value: "null" },
  { name: "Access-Control-Allow-Methods", value: "GET" },
  { name: "Access-Control-Allow-Headers", value: `Range, ${PREVIEW_PROXY_PRIORITY_HEADER}` },
];

/** Call on the capture page's own session before it navigates; keep the session for the page's life. */
export async function grantCaptureLoads(cdp: CaptureCdpSession, captureUrl: string): Promise<void> {
  const prefix = capturePreviewPrefix(captureUrl);
  if (!prefix) return;
  cdp.on("Fetch.requestPaused", (event) => {
    const { requestId } = event;
    const headers = event.responseHeaders ?? [];
    const status = event.responseStatusCode;
    const grant = captureLoadGrant(
      { url: event.request.url, method: event.request.method, resourceType: event.resourceType },
      captureUrl,
    );
    const answered =
      status !== undefined &&
      !headers.some((header) => header.name.toLowerCase() === "access-control-allow-origin");
    const sent =
      grant === "preflight"
        ? cdp.send("Fetch.fulfillRequest", {
            requestId,
            responseCode: 204,
            responseHeaders: PREFLIGHT_ANSWER,
          })
        : grant && answered
          ? cdp.send("Fetch.continueResponse", {
              requestId,
              responseCode: status,
              responseHeaders: [...headers, ...OPAQUE_CALLER],
            })
          : cdp.send("Fetch.continueRequest", { requestId });
    void sent.catch(() => undefined);
  });
  await cdp.send("Fetch.enable", {
    patterns: [...GRANTED_TYPES].map((resourceType) => ({
      urlPattern: `${prefix}*`,
      resourceType,
      requestStage: "Response",
    })),
  });
}
