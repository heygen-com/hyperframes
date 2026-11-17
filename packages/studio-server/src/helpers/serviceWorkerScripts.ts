import type { Context, Next } from "hono";

// A project file served as a worker's script would control the origin's pages after the project is gone.
export function serviceWorkerScriptFetch(headers: {
  serviceWorker?: string;
  fetchDest?: string;
}): boolean {
  return headers.serviceWorker === "script" || headers.fetchDest === "serviceworker";
}

export async function refuseServiceWorkerScripts(c: Context, next: Next) {
  const headers = {
    serviceWorker: c.req.header("service-worker"),
    fetchDest: c.req.header("sec-fetch-dest"),
  };
  if (serviceWorkerScriptFetch(headers)) return c.text("Forbidden", 403);
  await next();
}
