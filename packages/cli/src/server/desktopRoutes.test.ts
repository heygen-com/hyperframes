import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { desktopDownloadUrl, type DesktopOpenResult } from "../utils/desktopApp.js";
import { mountDesktopRoutes, sameOriginPost } from "./desktopRoutes.js";

const STUDIO = {
  host: "localhost:3002",
  origin: "http://localhost:3002",
  "sec-fetch-site": "same-origin",
};
const OPENED: DesktopOpenResult = {
  opened: true,
  app: "HyperFrames Studio",
  handedOver: null,
};

function server(
  ready: boolean,
  place: { platform?: NodeJS.Platform; installed?: () => boolean } = {},
) {
  const app = new Hono();
  const open = vi.fn((_dir: string): DesktopOpenResult => OPENED);
  mountDesktopRoutes(app, "/films/a", { ready, open, ...place });
  const post = (headers: Record<string, string>) =>
    app.request("/api/open-in-desktop", { method: "POST", headers });
  return { app, open, post };
}

describe("open-in-desktop routes", () => {
  it("tells Studio whether to show the button and whether the app can take the project", async () => {
    const body = await (
      await server(false, { installed: () => false }).app.request("/api/open-in-desktop")
    ).json();
    const downloadUrl = desktopDownloadUrl();
    expect(body).toEqual({ available: downloadUrl !== null, handoff: false, downloadUrl });
  });

  it("shows the button where the app is installed even without a download (Windows)", async () => {
    const get = async (installed: boolean) =>
      (
        await server(true, { platform: "win32", installed: () => installed }).app.request(
          "/api/open-in-desktop",
        )
      ).json();
    expect(await get(true)).toEqual({ available: true, handoff: true, downloadUrl: null });
    expect(await get(false)).toMatchObject({ available: false });
  });

  it("refuses a POST from another site, or through a rebound host name", async () => {
    const { open, post } = server(true);
    const crossSite = { ...STUDIO, origin: "https://evil.example", "sec-fetch-site": "cross-site" };
    expect((await post(crossSite)).status).toBe(403);
    expect(
      (await post({ ...STUDIO, host: "evil.example:3002", origin: "http://evil.example:3002" }))
        .status,
    ).toBe(403);
    expect(open).not.toHaveBeenCalled();
  });

  it("while gated, answers Studio's own POST with the download and opens nothing", async () => {
    const { open, post } = server(false);
    const res = await post(STUDIO);
    expect(await res.json()).toMatchObject({ opened: false, reason: "handoff-unavailable" });
    expect(open).not.toHaveBeenCalled();
  });

  it("once live, opens this server's project for Studio's own POST", async () => {
    const { open, post } = server(true);
    expect(await (await post(STUDIO)).json()).toEqual(OPENED);
    expect(open).toHaveBeenCalledWith("/films/a");
  });
});

describe("sameOriginPost", () => {
  it("lets a local process without browser headers through, never a foreign origin", () => {
    expect(sameOriginPost({ host: "127.0.0.1:3002" })).toBe(true);
    expect(sameOriginPost({ host: "localhost:3002", origin: "http://localhost:3003" })).toBe(false);
    expect(sameOriginPost({ host: "localhost:3002", fetchSite: "same-site" })).toBe(false);
    expect(sameOriginPost({})).toBe(false);
  });
});
