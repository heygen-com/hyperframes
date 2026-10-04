import type { Hono } from "hono";
import {
  HANDOFF_READY,
  desktopDownloadUrl,
  desktopInstalled,
  openInDesktop,
} from "../utils/desktopApp.js";
import { identityAllowed } from "./telemetryIdentity.js";

/** A bodiless POST is a simple request, so any page can send one to localhost: it has to come from this Studio. */
export function sameOriginPost(headers: {
  host?: string;
  origin?: string;
  fetchSite?: string;
}): boolean {
  const { host, origin, fetchSite } = headers;
  if (!host || !identityAllowed(host)) return false;
  if (fetchSite && fetchSite !== "same-origin") return false;
  return origin === undefined || origin === `http://${host}`;
}

/** Studio's Edit with Framey: the GET says whether to show it (the app is installed here or has a build to download),
 * where to get it, and whether the app can take the project. */
export function mountDesktopRoutes(
  app: Hono,
  projectDir: string,
  {
    ready = HANDOFF_READY,
    open = openInDesktop,
    platform = process.platform,
    installed = () => desktopInstalled({ platform }),
  } = {},
): void {
  const downloadUrl = desktopDownloadUrl(platform);
  app.get("/api/open-in-desktop", (c) =>
    c.json({ available: downloadUrl !== null || installed(), handoff: ready, downloadUrl }),
  );
  app.post("/api/open-in-desktop", (c) => {
    const allowed = sameOriginPost({
      host: c.req.header("host"),
      origin: c.req.header("origin"),
      fetchSite: c.req.header("sec-fetch-site"),
    });
    if (!allowed) return c.json({ error: "forbidden" }, 403);
    if (!ready)
      return c.json({
        opened: false,
        reason: "handoff-unavailable",
        downloadUrl,
      });
    return c.json(open(projectDir));
  });
}
