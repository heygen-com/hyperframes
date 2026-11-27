import type { Context, Next } from "hono";
import { serviceWorkerScriptFetch } from "@hyperframes/core/studio-preview-mark";

export { serviceWorkerScriptFetch };

// A project file served as a worker's script would control the origin's pages after the project is gone.

export async function refuseServiceWorkerScripts(c: Context, next: Next) {
  const headers = {
    serviceWorker: c.req.header("service-worker"),
    fetchDest: c.req.header("sec-fetch-dest"),
  };
  if (serviceWorkerScriptFetch(headers)) return c.text("Forbidden", 403);
  await next();
}
