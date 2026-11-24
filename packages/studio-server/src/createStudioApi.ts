import { Hono, type Context, type Next } from "hono";
import { routePath } from "hono/route";
import { injectTagsAtHeadStart } from "@hyperframes/core/compiler/html-document";
import { PREVIEW_FOR_ANOTHER_SITE_META } from "@hyperframes/core/studio-preview-mark";
import type { StudioApiAdapter, StudioRefusal, StudioRefusalWhy } from "./types.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerFileRoutes } from "./routes/files.js";
import {
  PREVIEW_CAPTURE_PARAM,
  PREVIEW_PROXY_PARAM,
  registerPreviewRoutes,
} from "./routes/preview.js";
import { registerLintRoutes } from "./routes/lint.js";
import { registerRenderRoutes } from "./routes/render.js";
import { registerImageThumbnailRoutes } from "./routes/imageThumbnail.js";
import { registerThumbnailRoutes } from "./routes/thumbnail.js";
import { registerWaveformRoutes } from "./routes/waveform.js";
import { registerFreezeFrameRoutes } from "./routes/freezeFrame.js";
import { registerLoudnessRoutes } from "./routes/loudness.js";
import { registerPeakRoutes } from "./routes/peaks.js";
import { registerFontRoutes } from "./routes/fonts.js";
import { registerRegistryRoutes } from "./routes/registry.js";
import { registerSelectionRoutes } from "./routes/selection.js";
import { registerRecoveryDraftRoutes } from "./routes/recoveryDrafts.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerGlobalAssetRoutes } from "./routes/globalAssets.js";
import { registerHistoryRoutes } from "./routes/history.js";
import { replaceWithProjectDirMissing } from "./helpers/projectDirMissing.js";
import { isProjectRootMissing } from "./helpers/safePath.js";
import { folderGoneOff } from "./helpers/projectDisk.js";
import {
  PREVIEW_ALLOWED_HOSTS_ENV,
  documentFromAnotherSite,
  requestFromAnotherSite,
  proxyWorkFromAnotherSite,
  requestHost,
  sameOriginPost,
} from "./helpers/requestIdentity.js";
import { refuseServiceWorkerScripts } from "./helpers/serviceWorkerScripts.js";
import { previewErrorPage } from "./helpers/previewErrorPage.js";
import type { CaptureSandboxOption } from "./helpers/captureLoads.js";
import {
  createFrameTokens,
  loadedThroughFrameToken,
  serveTokenPreviewPaths,
} from "./helpers/opaqueFrameLoads.js";
import { isFetchedAgain } from "./helpers/fetchAgain.js";

async function answerRefusedFrameWithPage(c: Context, next: Next) {
  await next();
  if (c.req.header("sec-fetch-dest") !== "iframe" || c.res.status < 400) return;
  const headers = new Headers(c.res.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.delete("content-length");
  c.res = new Response(previewErrorPage(c.res.status), {
    status: c.res.status,
    headers,
  });
}

const siteHeaders = (c: Context) => ({
  fetchSite: c.req.header("sec-fetch-site"),
  host: c.req.header("host") ?? urlHost(c.req.url),
  referer: c.req.header("referer"),
});
const fromAnotherSite = (c: Context) => requestFromAnotherSite(siteHeaders(c));
const documentForAnotherSite = (c: Context) => documentFromAnotherSite(siteHeaders(c));

const isThumbnailCapture = (c: Context) => c.req.query(PREVIEW_CAPTURE_PARAM) !== undefined;

async function markPreviewForAnotherSite(c: Context) {
  if (c.res.status !== 200 || !c.res.headers.get("content-type")?.startsWith("text/html")) return;
  const headers = new Headers(c.res.headers);
  headers.delete("content-length");
  headers.delete("etag");
  const marked = injectTagsAtHeadStart(
    await c.res.text(),
    `<meta name="${PREVIEW_FOR_ANOTHER_SITE_META}">`,
  );
  c.res = undefined;
  c.res = new Response(marked, { status: 200, headers });
}

const FRAMED_DESTS = new Set(["document", "iframe", "frame", "embed", "object", "fencedframe"]);
const framedByAnotherSite = (c: Context) => {
  if (!documentForAnotherSite(c)) return false;
  const dest = c.req.header("sec-fetch-dest");
  return dest === undefined || FRAMED_DESTS.has(dest);
};

function withoutValidators(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
  return new Request(request, { headers });
}

const sandboxPreviewForAnotherSiteOrCapture =
  (sandboxCaptures: boolean) => async (c: Context, next: Next) => {
    if (framedByAnotherSite(c)) c.req.raw = withoutValidators(c.req.raw);
    await next();
    c.header("Vary", "Sec-Fetch-Site, Referer", { append: true });
    const anotherSite = documentForAnotherSite(c);
    if (anotherSite || (sandboxCaptures && isThumbnailCapture(c)))
      c.header("Content-Security-Policy", "sandbox allow-scripts");
    if (anotherSite) await markPreviewForAnotherSite(c);
  };

async function refuseProxyWorkForAnotherSite(c: Context, next: Next) {
  const proxyWork = c.req.query(PREVIEW_PROXY_PARAM) !== undefined;
  if (proxyWork && proxyWorkFromAnotherSite(siteHeaders(c)) && !loadedThroughFrameToken(c.req.raw))
    return c.text("forbidden: media proxy requested by another site", 403);
  return next();
}

const refuseForAnotherSite = (what: string) => async (c: Context, next: Next) => {
  if (fromAnotherSite(c))
    return c.json(
      { error: `forbidden: ${what} requested by another site`, why: "another_site" },
      403,
    );
  return next();
};

function urlHost(url: string): string | undefined {
  try {
    return new URL(url).host || undefined;
  } catch {
    return undefined;
  }
}

function urlScheme(url: string): string | undefined {
  try {
    return new URL(url).protocol.replace(/:$/, "") || undefined;
  } catch {
    return undefined;
  }
}

const REFUSAL_WHYS: ReadonlySet<string> = new Set<StudioRefusalWhy>([
  "nul",
  "outside_project",
  "protected_path",
  "another_site",
  "cross_origin_write",
]);

const ENDPOINT_ASKED_FOR = -1;

const reportRefusals =
  (onRefusal: (refusal: StudioRefusal) => void) => async (c: Context, next: Next) => {
    const fetchedAgain = isFetchedAgain(c.req.raw);
    await next();
    if (c.res.status !== 403 || fetchedAgain) return;
    const body: unknown = await c.res
      .clone()
      .json()
      .catch(() => null);
    const why = body && typeof body === "object" ? (body as { why?: unknown }).why : undefined;
    try {
      onRefusal({
        route: routePath(c, ENDPOINT_ASKED_FOR),
        why: typeof why === "string" && REFUSAL_WHYS.has(why) ? (why as StudioRefusalWhy) : "other",
      });
    } catch {
      return;
    }
  };

export interface StudioApiOptions extends CaptureSandboxOption {
  allowedHosts?: readonly string[];
  subCompositionDeadlineMs?: number;
}

export function createStudioApi(adapter: StudioApiAdapter, options: StudioApiOptions = {}): Hono {
  const api = new Hono();
  if (adapter.onRefusal) api.use(reportRefusals(adapter.onRefusal));
  api.use(refuseServiceWorkerScripts);
  const sandboxThumbnailCaptures = options.sandboxThumbnailCaptures ?? false;
  const frameTokens = createFrameTokens();
  const resolveProjectId = (id: string) =>
    Promise.resolve()
      .then(() => adapter.resolveProject(id))
      .then(
        (project) => project?.id,
        () => undefined,
      );
  api.use("/projects/:id/preview/*", serveTokenPreviewPaths(api, frameTokens, resolveProjectId));
  api.use("/projects/:id/preview/*", refuseProxyWorkForAnotherSite);
  api.use(
    "/projects/:id/preview/*",
    sandboxPreviewForAnotherSiteOrCapture(sandboxThumbnailCaptures),
  );
  api.get("/projects/:id/frame-token", async (c) => {
    if (fromAnotherSite(c))
      return c.json({ error: "forbidden: requested by another site", why: "another_site" }, 403);
    const projectId = await resolveProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "not found" }, 404);
    return c.json({ token: frameTokens.tokenFor(projectId) }, 200, { "Cache-Control": "no-store" });
  });
  api.use("/projects/:id/thumbnail/*", refuseForAnotherSite("thumbnail"));
  api.use("/projects/:id/waveform/*", refuseForAnotherSite("waveform"));
  api.use("/projects/:id/peaks/*", refuseForAnotherSite("peaks"));
  api.use("/projects/:id/image-thumbnail/*", refuseForAnotherSite("image thumbnail"));
  api.use("/projects/:id/media/metadata", refuseForAnotherSite("media metadata"));
  api.use("/projects/:id/lint", refuseForAnotherSite("lint"));
  // This API is unauthenticated and simple cross-origin POSTs need no
  // preflight, so the guard rejects writes the shared predicate refuses.
  api.use(async function rejectCrossOriginWrites(c, next) {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") {
      return next();
    }
    const allowed = sameOriginPost({
      host: c.req.header("host") ?? urlHost(c.req.url),
      origin: c.req.header("origin"),
      fetchSite: c.req.header("sec-fetch-site"),
      proto: urlScheme(c.req.url),
      forwardedProto: c.req.header("x-forwarded-proto"),
      forwardedHost: c.req.header("x-forwarded-host"),
      allowedHosts: options.allowedHosts,
    });
    if (!allowed) {
      const refusedHost =
        requestHost({
          host: c.req.header("host") ?? urlHost(c.req.url),
          forwardedHost: c.req.header("x-forwarded-host"),
        }) ?? "unknown host";
      return c.json(
        {
          error:
            `forbidden: writes from host "${refusedHost}" are not allowed. ` +
            `Set ${PREVIEW_ALLOWED_HOSTS_ENV}=${refusedHost} to allow it ` +
            `(comma separated for several hosts).`,
          why: "cross_origin_write",
        },
        403,
      );
    }
    return next();
  });
  api.use("/projects/:id/preview/*", answerRefusedFrameWithPage);
  api.use("/projects/:id/preview", answerRefusedFrameWithPage);
  api.use(async function answerProjectDirMissingAfterErrorHandlers(c, next) {
    const hostHeaders = new Headers(c.res.headers);
    await next();
    if (isProjectRootMissing(c.error)) replaceWithProjectDirMissing(c, hostHeaders);
  });
  api.use("/projects/:id/*", async function answerProjectDirMissingForVanishedFolder(c, next) {
    const hostHeaders = new Headers(c.res.headers);
    const dirBeforeRoute = await Promise.resolve()
      .then(() => adapter.resolveProject(c.req.param("id")))
      .then(
        (project) => project?.dir,
        () => undefined,
      );
    await next();
    if (c.res.status >= 403 && dirBeforeRoute && (await folderGoneOff(dirBeforeRoute)))
      replaceWithProjectDirMissing(c, hostHeaders);
  });
  api.use("/projects/:id/*", async function forgetSignatureAfterWrite(c, next) {
    await next();
    if (c.req.method === "GET" || c.req.method === "HEAD") return;
    const project = await Promise.resolve()
      .then(() => adapter.resolveProject(c.req.param("id")))
      .catch(() => null);
    if (project) adapter.invalidateProjectSignature?.(project.dir);
  });
  api.use("/projects/:id/*", async function openHistorySoNoWriteBecomesItsBaseline(c, next) {
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && adapter.history) {
      await Promise.resolve()
        .then(() => adapter.resolveProject(c.req.param("id")))
        .then((project) => project && adapter.history?.(project))
        .catch(() => null);
    }
    await next();
  });

  registerProjectRoutes(api, adapter);
  registerFileRoutes(api, adapter);
  registerPreviewRoutes(api, adapter, {
    sandboxThumbnailCaptures,
    subCompositionDeadlineMs: options.subCompositionDeadlineMs,
  });
  registerLintRoutes(api, adapter);
  registerRenderRoutes(api, adapter);
  registerThumbnailRoutes(
    api,
    adapter,
    sandboxThumbnailCaptures ? frameTokens.tokenFor : undefined,
  );
  registerImageThumbnailRoutes(api, adapter);
  registerSelectionRoutes(api, adapter);
  registerRecoveryDraftRoutes(api, adapter);
  registerMediaRoutes(api, adapter);
  registerWaveformRoutes(api, adapter);
  registerFreezeFrameRoutes(api, adapter);
  registerLoudnessRoutes(api, adapter);
  registerPeakRoutes(api, adapter);
  registerFontRoutes(api);
  registerRegistryRoutes(api, adapter);
  registerGlobalAssetRoutes(api);
  registerHistoryRoutes(api, adapter);

  return api;
}
