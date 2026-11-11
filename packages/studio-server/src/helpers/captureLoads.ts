/**
 * A thumbnail capture document is served with `Content-Security-Policy: sandbox allow-scripts`
 * (createStudioApi), so its scripts run in an opaque origin and cannot use the Studio API. Loads that
 * the browser makes in CORS mode then fail too: fonts, module scripts, images drawn for color grading,
 * and the runtime's fetch of a nested composition. The renderer that opened the capture page is trusted,
 * so it adds the CORS header to those responses itself, for that page only, by the kind of each load.
 * Only GETs of the project's own preview files are granted, and `fetch()` reads only the files the
 * runtime fetches to draw a frame: `.html` scenes, `.json` and `.cube` LUTs.
 */

const RUNTIME_READS = /\.(html?|json|cube)$/i;

/** File kinds an opaque capture page may load with CORS, by Chrome's resource type. Chrome reports
 * a page's `fetch()` as `XHR` to the Fetch domain. */
const CAPTURE_LOADS = new Map<string, RegExp>([
  ["Font", /\.(woff2?|ttf|otf)$/i],
  ["Script", /\.m?js$/i],
  ["Image", /\.(png|jpe?g|gif|webp|avif|svg)$/i],
  ["Fetch", RUNTIME_READS],
  ["XHR", RUNTIME_READS],
]);

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

/** Whether the capture page at `captureUrl` may read `load` across its opaque origin. */
export function captureLoadGetsCors(load: CaptureLoad, captureUrl: string): boolean {
  const prefix = previewPrefix(captureUrl);
  if (!prefix || load.method !== "GET" || !load.url.startsWith(prefix)) return false;
  return CAPTURE_LOADS.get(load.resourceType)?.test(new URL(load.url).pathname) ?? false;
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

/** Adds `Access-Control-Allow-Origin: null` to the capture page's loads that `captureLoadGetsCors`
 * allows. Call it on the page's own session before navigating, and keep the session for the page's life. */
export async function grantCaptureLoads(cdp: CaptureCdpSession, captureUrl: string): Promise<void> {
  const prefix = previewPrefix(captureUrl);
  if (!prefix) return;
  cdp.on("Fetch.requestPaused", (event) => {
    const headers = event.responseHeaders ?? [];
    const status = event.responseStatusCode ?? 0;
    const grant =
      status >= 200 &&
      status < 300 &&
      !headers.some((header) => header.name.toLowerCase() === "access-control-allow-origin") &&
      captureLoadGetsCors(
        { url: event.request.url, method: event.request.method, resourceType: event.resourceType },
        captureUrl,
      );
    void (
      grant
        ? cdp.send("Fetch.continueResponse", {
            requestId: event.requestId,
            responseCode: status,
            responseHeaders: [
              ...headers,
              { name: "Access-Control-Allow-Origin", value: "null" },
              { name: "X-Content-Type-Options", value: "nosniff" },
            ],
          })
        : cdp.send("Fetch.continueRequest", { requestId: event.requestId })
    ).catch(() => undefined);
  });
  await cdp.send("Fetch.enable", {
    patterns: [...CAPTURE_LOADS.keys()].map((resourceType) => ({
      urlPattern: `${prefix}*`,
      resourceType,
      requestStage: "Response",
    })),
  });
}
