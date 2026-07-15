import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";

const INSTALL_HINT = "Install the VST host: uv tool install hyperframes-vst-host (requires uv)";

export function registerVstRoutes(api: Hono, adapter: StudioApiAdapter): void {
  api.post("/vst/start", async (c) => {
    if (!adapter.startVstSidecar) {
      return c.json(
        { error: "VST host not available in this studio mode", installHint: INSTALL_HINT },
        503,
      );
    }
    try {
      const { port } = await adapter.startVstSidecar();
      return c.json({ port });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, installHint: INSTALL_HINT }, 503);
    }
  });

  api.get("/vst/status", (c) => {
    if (!adapter.getVstSidecarStatus) {
      return c.json({ running: false, port: null });
    }
    return c.json(adapter.getVstSidecarStatus());
  });
}
