import { Hono } from "hono";
import type { StudioApiAdapter } from "./types.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerPreviewRoutes } from "./routes/preview.js";
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
import { registerMediaRoutes } from "./routes/media.js";
import { registerGlobalAssetRoutes } from "./routes/globalAssets.js";
import { registerHistoryRoutes } from "./routes/history.js";
import { replaceWithProjectDirMissing } from "./helpers/projectDirMissing.js";
import { folderGone, isProjectRootMissing } from "./helpers/safePath.js";
import { sameOriginPost } from "./helpers/requestIdentity.js";

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

export interface StudioApiOptions {
  /**
   * Extra host names the write guard accepts as this server, for hosts
   * mounting the API on their own domain or behind a tunnel or proxy.
   */
  allowedHosts?: readonly string[];
}

export function createStudioApi(adapter: StudioApiAdapter, options: StudioApiOptions = {}): Hono {
  const api = new Hono();
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
    if (!allowed) return c.json({ error: "forbidden" }, 403);
    return next();
  });
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
    if (c.res.status >= 403 && dirBeforeRoute && folderGone(dirBeforeRoute))
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
  registerPreviewRoutes(api, adapter);
  registerLintRoutes(api, adapter);
  registerRenderRoutes(api, adapter);
  registerThumbnailRoutes(api, adapter);
  registerImageThumbnailRoutes(api, adapter);
  registerSelectionRoutes(api, adapter);
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
