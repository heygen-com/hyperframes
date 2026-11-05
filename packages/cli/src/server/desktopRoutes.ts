import type { Hono } from "hono";
import {
  HANDOFF_READY,
  desktopDownloadUrl,
  desktopInstalled,
  openInDesktop,
} from "../utils/desktopApp.js";
import { identityAllowed } from "./telemetryIdentity.js";

const CTA_ID = /^[A-Za-z0-9-]{1,64}$/;

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

/** The desktop-app button's route: show it or not, the download, and whether the app here takes the project. */
export function mountDesktopRoutes(
  app: Hono,
  projectDir: string,
  {
    ready = HANDOFF_READY,
    open = (dir: string, cta?: string) => openInDesktop(dir, { cta, src: "browser-editor" }),
    platform = process.platform,
    installed = () => desktopInstalled({ platform }),
  } = {},
): void {
  const downloadUrl = desktopDownloadUrl(platform, "browser-editor");
  app.get("/api/open-in-desktop", (c) => {
    const here = installed();
    return c.json({
      available: downloadUrl !== null || here,
      handoff: ready && here,
      downloadUrl,
      os: platform,
      installed: here,
    });
  });
  app.post("/api/open-in-desktop", async (c) => {
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
    const body: unknown = await c.req.json().catch(() => null);
    const cta = (body as { cta?: unknown } | null)?.cta;
    return c.json(open(projectDir, typeof cta === "string" && CTA_ID.test(cta) ? cta : undefined));
  });
}
