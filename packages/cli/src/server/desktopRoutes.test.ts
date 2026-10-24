import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { desktopDownloadUrl, type DesktopOpenResult } from "../utils/desktopApp.js";
import { mountDesktopRoutes } from "./desktopRoutes.js";
import { sameOriginPost } from "@hyperframes/studio-server/request-identity";

const STUDIO = {
  host: "localhost:3002",
  origin: "http://localhost:3002",
  "sec-fetch-site": "same-origin",
};
const OPENED: DesktopOpenResult = {
  opened: true,
  app: "the HyperFrames desktop app",
  handedOver: null,
};

function server(
  ready: boolean,
  place: { platform?: NodeJS.Platform; installed?: () => boolean } = {},
) {
  const app = new Hono();
  const open = vi.fn((_dir: string, _cta?: string): DesktopOpenResult => OPENED);
  mountDesktopRoutes(app, "/films/a", { ready, open, ...place });
  const post = (headers: Record<string, string>, body?: unknown) =>
    app.request("/api/open-in-desktop", {
      method: "POST",
      headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { app, open, post };
}

describe("open-in-desktop routes", () => {
  it("tells Studio whether to show the button and whether the app can take the project", async () => {
    const body = await (
      await server(false, { installed: () => false }).app.request("/api/open-in-desktop")
    ).json();
    const downloadUrl = desktopDownloadUrl();
    expect(body).toEqual({
      available: downloadUrl !== null,
      handoff: false,
      downloadUrl,
      os: process.platform,
      installed: false,
    });
  });

  it("shows the button where the app is installed even without a download (Windows)", async () => {
    const get = async (installed: boolean) =>
      (
        await server(true, { platform: "win32", installed: () => installed }).app.request(
          "/api/open-in-desktop",
        )
      ).json();
    expect(await get(true)).toEqual({
      available: true,
      handoff: true,
      downloadUrl: null,
      os: "win32",
      installed: true,
    });
    expect(await get(false)).toMatchObject({ available: false });
  });

  it("offers the hand-off only where the app is installed, so a press without it goes to the download", async () => {
    const get = async (installed: boolean) =>
      (
        await server(true, { platform: "darwin", installed: () => installed }).app.request(
          "/api/open-in-desktop",
        )
      ).json();
    expect(await get(true)).toMatchObject({ available: true, handoff: true });
    expect(await get(false)).toEqual({
      available: true,
      handoff: false,
      downloadUrl: desktopDownloadUrl("darwin"),
      os: "darwin",
      installed: false,
    });
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
    expect(open).toHaveBeenCalledWith("/films/a", undefined);
  });

  it("passes the press's page id on to the hand-off, and drops anything that is not one", async () => {
    const { open, post } = server(true);
    const id = "3f2b8c1e-9a4d-4e7b-8c21-5d6e7f8a9b0c";
    await post(STUDIO, { cta: id });
    await post(STUDIO, { cta: "../../etc/passwd" });
    await post(STUDIO, { cta: 42 });
    expect(open.mock.calls).toEqual([
      ["/films/a", id],
      ["/films/a", undefined],
      ["/films/a", undefined],
    ]);
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
