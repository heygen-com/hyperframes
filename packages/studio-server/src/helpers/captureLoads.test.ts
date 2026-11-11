import { describe, expect, it, vi } from "vitest";
import { captureLoadGrant, grantCaptureLoads, type CaptureCdpSession } from "./captureLoads";

const ORIGIN = "http://127.0.0.1:3002";
const PREVIEW = `${ORIGIN}/api/projects/demo/preview`;
const CAPTURE = `${PREVIEW}/comp/compositions/intro.html?hf-capture=1`;

describe("captureLoadGrant", () => {
  it.each([
    ["Font", `${PREVIEW}/assets/brand.woff2`],
    ["Script", `${PREVIEW}/assets/scene.mjs`],
    ["Stylesheet", `${PREVIEW}/style.css`],
    ["Image", `${PREVIEW}/assets/logo.png`],
    ["Media", `${PREVIEW}/assets/clip.mp4`],
    ["Media", `${PREVIEW}/assets/clip.mov?hf-proxy=h264`],
    ["XHR", `${PREVIEW}/compositions/scene.html`],
    ["Fetch", `${PREVIEW}/models/device.glb`],
    ["XHR", `${PREVIEW}/assets/fonts/Geist-Bold.ttf`],
    ["XHR", `${PREVIEW}/notes.txt`],
    ["XHR", `${PREVIEW}/assets/clip.mov?hf-proxy=h264&hf-proxy-box=1448x724`],
    ["Image", `${PREVIEW}/assets%2Flogo%20v2.png`],
  ])("lets the frame read a %s load of %s", (resourceType, url) => {
    expect(captureLoadGrant({ url, method: "GET", resourceType }, CAPTURE)).toBe("read");
  });

  it("answers the preflight of the runtime's wait for a video's preview copy", () => {
    const url = `${PREVIEW}/assets/clip.mov?hf-proxy=h264&hf-proxy-box=1448x724`;
    expect(captureLoadGrant({ url, method: "OPTIONS", resourceType: "XHR" }, CAPTURE)).toBe(
      "preflight",
    );
  });

  it.each([
    ["XHR", `${PREVIEW}/.env`, "GET"],
    ["XHR", `${PREVIEW}/.git/config`, "GET"],
    ["XHR", `${PREVIEW}/assets/.npmrc`, "GET"],
    ["XHR", `${PREVIEW}/%2Eenv`, "GET"],
    ["XHR", `${PREVIEW}/assets%2F.npmrc`, "GET"],
    ["Fetch", `${PREVIEW}/assets%2F.config%2Fsettings.json`, "GET"],
    ["XHR", `${PREVIEW}/x%2F..%2F.npmrc`, "GET"],
    ["XHR", `${PREVIEW}/assets%5C.npmrc`, "GET"],
    ["XHR", `${PREVIEW}/%E0%A4%A.html`, "GET"],
    ["Script", `${PREVIEW}/.env`, "GET"],
    ["Image", `${PREVIEW}/.git/logo.png`, "GET"],
    ["Document", `${PREVIEW}/compositions/scene.html`, "GET"],
    ["XHR", `${ORIGIN}/api/projects/demo/files/index.html`, "GET"],
    ["XHR", `${ORIGIN}/api/projects/other/preview/index.html`, "GET"],
    ["XHR", `http://127.0.0.1:9999/api/projects/demo/preview/index.html`, "GET"],
    ["XHR", `${PREVIEW}/compositions/scene.html`, "PUT"],
    ["XHR", `${PREVIEW}/compositions/scene.html`, "POST"],
    ["XHR", `${PREVIEW}/compositions/scene.html`, "OPTIONS"],
    ["XHR", `${PREVIEW}/.env?hf-proxy=h264`, "OPTIONS"],
    ["XHR", `${PREVIEW}/notes.txt?hf-proxy=h264`, "OPTIONS"],
    ["XHR", `${PREVIEW}/assets/clip.mov?hf-proxy=h264`, "PUT"],
  ])("refuses a %s load of %s (%s)", (resourceType, url, method) => {
    expect(captureLoadGrant({ url, method, resourceType }, CAPTURE)).toBeNull();
  });

  it("grants nothing for a URL that is not a preview document", () => {
    const load = { url: `${PREVIEW}/assets/brand.woff2`, method: "GET", resourceType: "Font" };
    expect(captureLoadGrant(load, `${ORIGIN}/api/projects/demo/files/index.html`)).toBeNull();
    expect(captureLoadGrant(load, "not a url")).toBeNull();
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
    expect(patterns.map((pattern) => pattern.resourceType)).toEqual(
      expect.arrayContaining(["Font", "Image", "Media", "XHR"]),
    );
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
        expect.objectContaining({ name: "Access-Control-Expose-Headers" }),
      ],
    });
  });

  it("lets the frame read a missing file's status, as a same-origin page would", async () => {
    const { session, send, pause } = fakeSession();
    await grantCaptureLoads(session, CAPTURE);
    pause(response(`${PREVIEW}/assets/fonts/Missing.ttf`, "XHR", { responseStatusCode: 404 }));
    expect(send).toHaveBeenLastCalledWith(
      "Fetch.continueResponse",
      expect.objectContaining({ responseCode: 404 }),
    );
  });

  it("exposes the preview copy's progress headers to the runtime's wait", async () => {
    const { session, send, pause } = fakeSession();
    await grantCaptureLoads(session, CAPTURE);
    pause(
      response(`${PREVIEW}/assets/clip.mov?hf-proxy=h264`, "XHR", {
        responseStatusCode: 202,
        responseHeaders: [{ name: "Retry-After", value: "2" }],
      }),
    );
    expect(send).toHaveBeenLastCalledWith("Fetch.continueResponse", {
      requestId: "r1",
      responseCode: 202,
      responseHeaders: expect.arrayContaining([
        { name: "Access-Control-Allow-Origin", value: "null" },
        { name: "Access-Control-Expose-Headers", value: expect.stringContaining("Retry-After") },
      ]),
    });
  });

  it("answers the wait's preflight itself, whatever the server said", async () => {
    const { session, send, pause } = fakeSession();
    await grantCaptureLoads(session, CAPTURE);
    pause({
      ...response(`${PREVIEW}/assets/clip.mov?hf-proxy=h264`, "XHR", { responseStatusCode: 404 }),
      request: { url: `${PREVIEW}/assets/clip.mov?hf-proxy=h264`, method: "OPTIONS" },
    });
    expect(send).toHaveBeenLastCalledWith("Fetch.fulfillRequest", {
      requestId: "r1",
      responseCode: 204,
      responseHeaders: expect.arrayContaining([
        { name: "Access-Control-Allow-Origin", value: "null" },
        { name: "Access-Control-Allow-Methods", value: "GET" },
      ]),
    });
  });

  it.each([
    ["a file fetch() may not read", response(`${PREVIEW}/.env`, "XHR")],
    [
      "a request paused before its response",
      response(`${PREVIEW}/assets/brand.woff2`, "Font", { responseStatusCode: undefined }),
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
