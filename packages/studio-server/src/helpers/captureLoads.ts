import { PREVIEW_PROXY_PRIORITY_HEADER, PREVIEW_PROXY_PROGRESS_HEADER } from "@hyperframes/core";

/**
 * A thumbnail capture document is served with `Content-Security-Policy: sandbox allow-scripts`
 * (createStudioApi), so its scripts run in an opaque origin and cannot use the Studio API. Loads that
 * the browser makes in CORS mode then fail too: fonts, module scripts, images drawn for color grading,
 * the runtime's fetch of a nested composition, and its wait for a video's preview copy. The renderer
 * that opened the capture page is trusted, so it adds the CORS headers to those responses itself, for
 * that page only, by the kind of each load. Only the project's own preview files qualify, and
 * `fetch()` reads only what the runtime fetches to draw a frame: `.html` scenes, `.json`, `.cube`
 * LUTs and a video's `?hf-proxy=` copy.
 */

const RUNTIME_READS = /\.(html?|json|cube)$/i;

/** File kinds an opaque capture page may load with CORS, by Chrome's resource type. Chrome reports
 * a page's `fetch()`, and its preflight, as `XHR` to the Fetch domain. */
const CAPTURE_LOADS = new Map<string, RegExp>([
  ["Font", /\.(woff2?|ttf|otf)$/i],
  ["Script", /\.m?js$/i],
  ["Image", /\.(png|jpe?g|gif|webp|avif|svg)$/i],
  ["Fetch", RUNTIME_READS],
  ["XHR", RUNTIME_READS],
]);

// The server makes a `?hf-proxy=` copy of a video file only, and answers anything else with a 404.
const PROXY_PARAM = "hf-proxy";
const VIDEO_FILE = /\.(mp4|webm|mov|mkv|avi|m4v|mxf|mts|m2ts)$/i;

/** `<origin>/api/projects/<id>/preview/` for a capture URL, or null for any other URL. */
function previewPrefix(captureUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(captureUrl);
  } catch {
    return null;
  }
  const path = /^\/api\/projects\/[^/]+\/preview(?=\/|$)/.exec(url.pathname)?.[0];
  return path ? `${url.origin}${path}/` : null;
}

export interface CaptureLoad {
  url: string;
  method: string;
  resourceType: string;
}

/**
 * What the capture page at `captureUrl` may do with `load` across its opaque origin:
 * - `read`: a file the frame draws from;
 * - `proxy`: the runtime's wait for a video's preview copy (`proxyWait.ts`), which reads its status
 *   and progress headers;
 * - `preflight`: that wait's preflight, sent when it carries the priority header.
 */
export function captureLoadGrant(
  load: CaptureLoad,
  captureUrl: string,
): "read" | "proxy" | "preflight" | null {
  const prefix = previewPrefix(captureUrl);
  if (!prefix || !load.url.startsWith(prefix)) return null;
  const url = new URL(load.url);
  const fetched = load.resourceType === "XHR" || load.resourceType === "Fetch";
  if (fetched && url.searchParams.has(PROXY_PARAM) && VIDEO_FILE.test(url.pathname)) {
    if (load.method === "OPTIONS") return "preflight";
    if (load.method === "GET") return "proxy";
    return null;
  }
  if (load.method !== "GET") return null;
  return CAPTURE_LOADS.get(load.resourceType)?.test(url.pathname) ? "read" : null;
}

type Header = { name: string; value: string };

/** The part of a CDP session this needs; puppeteer's `CDPSession` fits it. */
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
];
const PROXY_HEADERS: Header[] = [
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

/** Grants the capture page's loads that `captureLoadGrant` allows. Call it on the page's own session
 * before navigating, and keep the session for the page's life. */
export async function grantCaptureLoads(cdp: CaptureCdpSession, captureUrl: string): Promise<void> {
  const prefix = previewPrefix(captureUrl);
  if (!prefix) return;
  cdp.on("Fetch.requestPaused", (event) => {
    const { requestId } = event;
    const headers = event.responseHeaders ?? [];
    const status = event.responseStatusCode ?? 0;
    const grant = captureLoadGrant(
      { url: event.request.url, method: event.request.method, resourceType: event.resourceType },
      captureUrl,
    );
    const answered =
      status >= 200 &&
      status < 300 &&
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
              responseHeaders: [
                ...headers,
                ...OPAQUE_CALLER,
                ...(grant === "proxy" ? PROXY_HEADERS : []),
              ],
            })
          : cdp.send("Fetch.continueRequest", { requestId });
    void sent.catch(() => undefined);
  });
  await cdp.send("Fetch.enable", {
    patterns: [...CAPTURE_LOADS.keys()].map((resourceType) => ({
      urlPattern: `${prefix}*`,
      resourceType,
      requestStage: "Response",
    })),
  });
}
