import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_CDN } from "./grid.mjs";

const require = createRequire(import.meta.url);
const gsapUrl = `${FIXTURE_CDN}npm/gsap@${require("gsap/package.json").version}/dist/gsap.min.js`;
const sent = [];
const handlers = {};
const sessionArgs = [];
const page = {
  createCDPSession: async () => ({
    on: (event, handler) => (handlers[event] = handler),
    send: async (method, params) => void sent.push({ method, params }),
  }),
  evaluate: async () => null,
};

vi.mock("../../../../producer/src/index.js", () => ({
  createFileServer: async () => ({ url: "http://127.0.0.1:1", close() {} }),
  createCaptureSession: async (...args) => (sessionArgs.push(args), { page }),
  // Navigation: Chrome pauses the fixture's GSAP request here when it is intercepted.
  initializeSession: async () =>
    handlers["Fetch.requestPaused"]?.({ requestId: "1", request: { url: gsapUrl } }),
  captureFrameToBuffer: async () => ({ buffer: Buffer.alloc(0) }),
  closeCaptureSession: async () => undefined,
}));

describe("renderBox", () => {
  it("serves the fixture's GSAP from the repo and opens no second page that would fetch it", async () => {
    const { renderBox } = await import("./render.mjs");
    const dir = mkdtempSync(join(tmpdir(), "edit-bench-render-"));
    const decoder = { evaluate: async () => ({ left: 0, right: 1, top: 0, bottom: 1, area: 1 }) };
    try {
      await renderBox(dir, decoder);
    } finally {
      rmSync(dir, { recursive: true });
    }
    expect(sent.map((s) => s.method)).toEqual(["Fetch.enable", "Fetch.fulfillRequest"]);
    const [{ urlPattern }] = sent[0].params.patterns;
    expect(gsapUrl.startsWith(urlPattern.replace(/\*$/, ""))).toBe(true);
    const gsap = readFileSync(require.resolve("gsap/dist/gsap.min.js")).toString("base64");
    expect(sent[1].params.body).toBe(gsap);
    expect(sessionArgs[0][4]).toMatchObject({ staticFrameDedup: false });
  });
});
