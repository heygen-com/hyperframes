import type { Hono } from "hono";
import {
  HANDOFF_READY,
  desktopDownloadUrl,
  desktopInstalled,
  openInDesktop,
} from "../utils/desktopApp.js";
import { sameOriginPost } from "@hyperframes/studio-server/request-identity";

/** Scheme of a request URL ("http" or "https"), or undefined when it does not parse. */
function urlSchemeOf(url: string): string | undefined {
  try {
    return new URL(url).protocol.replace(/:$/, "") || undefined;
  } catch {
    return undefined;
  }
}

const CTA_ID = /^[A-Za-z0-9-]{1,64}$/;

/** The desktop-app button's route: show it or not, the download, and whether the app here takes the project. */
export function mountDesktopRoutes(
  app: Hono,
  projectDir: string,
  {
    ready = HANDOFF_READY,
    open = (dir: string, cta?: string) => openInDesktop(dir, { cta }),
    platform = process.platform,
    installed = () => desktopInstalled({ platform }),
  } = {},
): void {
  const downloadUrl = desktopDownloadUrl(platform);
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
      proto: urlSchemeOf(c.req.url),
      forwardedProto: c.req.header("x-forwarded-proto"),
      forwardedHost: c.req.header("x-forwarded-host"),
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
