import { Hono } from "hono";
import type { StudioApiAdapter } from "./types.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerStoryboardRoutes } from "./routes/storyboard.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerPreviewRoutes } from "./routes/preview.js";
import { registerLintRoutes } from "./routes/lint.js";
import { registerRenderRoutes } from "./routes/render.js";
import { registerThumbnailRoutes } from "./routes/thumbnail.js";
import { registerWaveformRoutes } from "./routes/waveform.js";
import { registerFontRoutes } from "./routes/fonts.js";
import { registerRegistryRoutes } from "./routes/registry.js";
import { registerSelectionRoutes } from "./routes/selection.js";

/**
 * Create a Hono sub-app with all studio API routes.
 *
 * Both the vite dev server and CLI embedded server mount this app
 * under /api, each providing their own adapter for host-specific behavior.
 */
export function createStudioApi(adapter: StudioApiAdapter): Hono {
  const api = new Hono();

  registerProjectRoutes(api, adapter);
  registerStoryboardRoutes(api, adapter);
  registerFileRoutes(api, adapter);
  registerPreviewRoutes(api, adapter);
  registerLintRoutes(api, adapter);
  registerRenderRoutes(api, adapter);
  registerThumbnailRoutes(api, adapter);
  registerSelectionRoutes(api, adapter);
  registerWaveformRoutes(api, adapter);
  registerFontRoutes(api);
  registerRegistryRoutes(api, adapter);

  return api;
}
