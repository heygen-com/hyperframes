import { describe, expect, it, vi } from "vitest";
import { captureLoadGetsCors, grantCaptureLoads, type CaptureCdpSession } from "./captureLoads";

const ORIGIN = "http://127.0.0.1:3002";
const PREVIEW = `${ORIGIN}/api/projects/demo/preview`;
const CAPTURE = `${PREVIEW}/comp/compositions/intro.html?hf-capture=1`;

describe("captureLoadGetsCors", () => {
  it.each([
    ["Font", `${PREVIEW}/assets/brand.woff2`],
    ["Font", `${PREVIEW}/fonts/Display.ttf?v=2`],
    ["Script", `${PREVIEW}/assets/scene.mjs`],
    ["Image", `${PREVIEW}/assets/logo.png`],
    ["XHR", `${PREVIEW}/compositions/scene.html`],
    ["Fetch", `${PREVIEW}/caption-overrides.json`],
    ["XHR", `${PREVIEW}/luts/warm.cube`],
  ])("grants a %s load of %s", (resourceType, url) => {
    expect(captureLoadGetsCors({ url, method: "GET", resourceType }, CAPTURE)).toBe(true);
  });

  it.each([
    ["XHR", `${PREVIEW}/.env`, "GET"],
    ["XHR", `${PREVIEW}/.git/config`, "GET"],
    ["Fetch", `${PREVIEW}/notes.txt`, "GET"],
    ["Script", `${PREVIEW}/.env`, "GET"],
    ["Font", `${PREVIEW}/secrets.txt`, "GET"],
    ["Stylesheet", `${PREVIEW}/style.css`, "GET"],
    ["XHR", `${ORIGIN}/api/projects/demo/files/index.html`, "GET"],
    ["XHR", `${ORIGIN}/api/projects/other/preview/index.html`, "GET"],
    ["XHR", `http://127.0.0.1:9999/api/projects/demo/preview/index.html`, "GET"],
    ["XHR", `${PREVIEW}/compositions/scene.html`, "PUT"],
    ["XHR", `${PREVIEW}/compositions/scene.html`, "POST"],
  ])("refuses a %s load of %s (%s)", (resourceType, url, method) => {
    expect(captureLoadGetsCors({ url, method, resourceType }, CAPTURE)).toBe(false);
  });

  it("grants nothing for a URL that is not a preview document", () => {
    const load = { url: `${PREVIEW}/assets/brand.woff2`, method: "GET", resourceType: "Font" };
    expect(captureLoadGetsCors(load, `${ORIGIN}/api/projects/demo/files/index.html`)).toBe(false);
    expect(captureLoadGetsCors(load, "not a url")).toBe(false);
  });
});

type Paused = Parameters<Parameters<CaptureCdpSession["on"]>[1]>[0];

function fakeSession() {
  let paused: ((event: Paused) => void) | undefined;
  const send = vi.fn(async (_method: string, _params?: object) => undefined);
  const session: CaptureCdpSession = {
    send,
    on: (_event, handler) => {
      paused = handler;
    },
  };
  return { session, send, pause: (event: Paused) => paused?.(event) };
}

const response = (url: string, resourceType: string, extra: Partial<Paused> = {}): Paused => ({
  requestId: "r1",
  request: { url, method: "GET" },
  resourceType,
  responseStatusCode: 200,
  responseHeaders: [{ name: "Content-Type", value: "font/woff2" }],
  ...extra,
});

describe("grantCaptureLoads", () => {
  it("intercepts responses under the project's preview path only", async () => {
    const { session, send } = fakeSession();
    await grantCaptureLoads(session, CAPTURE);
    const enable = send.mock.calls.find(([method]) => method === "Fetch.enable");
    expect(enable).toBeDefined();
    const { patterns } = enable![1] as { patterns: Array<Record<string, string>> };
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      expect(pattern.urlPattern).toBe(`${PREVIEW}/*`);
      expect(pattern.requestStage).toBe("Response");
    }
  });

  it("adds the CORS header to a granted load and keeps its own headers", async () => {
    const { session, send, pause } = fakeSession();
    await grantCaptureLoads(session, CAPTURE);
    pause(response(`${PREVIEW}/assets/brand.woff2`, "Font"));
    expect(send).toHaveBeenLastCalledWith("Fetch.continueResponse", {
      requestId: "r1",
      responseCode: 200,
      responseHeaders: [
        { name: "Content-Type", value: "font/woff2" },
        { name: "Access-Control-Allow-Origin", value: "null" },
        { name: "X-Content-Type-Options", value: "nosniff" },
      ],
    });
  });

  it.each([
    ["a file fetch() may not read", response(`${PREVIEW}/.env`, "XHR")],
    [
      "a failed load",
      response(`${PREVIEW}/assets/brand.woff2`, "Font", { responseStatusCode: 404 }),
    ],
    [
      "a load that already answers CORS",
      response(`${PREVIEW}/assets/brand.woff2`, "Font", {
        responseHeaders: [{ name: "access-control-allow-origin", value: "*" }],
      }),
    ],
  ])("passes %s through unchanged", async (_name, event) => {
    const { session, send, pause } = fakeSession();
    await grantCaptureLoads(session, CAPTURE);
    pause(event);
    expect(send).toHaveBeenLastCalledWith("Fetch.continueRequest", { requestId: "r1" });
  });

  it("does nothing for a URL that is not a preview document", async () => {
    const { session, send } = fakeSession();
    await grantCaptureLoads(session, `${ORIGIN}/api/projects/demo/files/index.html`);
    expect(send).not.toHaveBeenCalled();
  });
});
