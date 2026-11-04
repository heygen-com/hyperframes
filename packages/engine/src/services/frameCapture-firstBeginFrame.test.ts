import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureFrameToBuffer, createCaptureSession } from "./frameCapture.js";
import { beginFrameCapture } from "./screenshotService.js";

const calls: string[] = [];

vi.mock("./browserManager.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./browserManager.js")>()),
  resolveBrowserGpuMode: async () => "software",
  acquireBrowser: async () => ({
    captureMode: "beginframe",
    browser: {
      version: async () => "HeadlessChrome/150.0.0.0",
      newPage: async () => ({
        mainFrame: () => ({}),
        evaluateOnNewDocument: async () => {},
        setViewport: async () => {},
        evaluate: async () => undefined,
        createCDPSession: async () => ({
          send: async (
            method: string,
            params: { frameTimeTicks?: number; noDisplayUpdates?: boolean },
          ) => {
            calls.push(
              `${method} ticks=${params.frameTimeTicks} noDisplayUpdates=${params.noDisplayUpdates}`,
            );
            return {};
          },
        }),
      }),
    },
  }),
}));
vi.mock("./screenshotService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./screenshotService.js")>()),
  beginFrameCapture: vi.fn(async (_page: unknown, _options: unknown, frameTimeTicks: number) => {
    calls.push(`capture ticks=${frameTimeTicks}`);
    return { buffer: Buffer.alloc(8), hasDamage: true };
  }),
}));

const dirs: string[] = [];
afterEach(() => {
  calls.length = 0;
  vi.mocked(beginFrameCapture).mockClear();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function beginFrameSession(baseTicks: number) {
  const dir = mkdtempSync(join(tmpdir(), "hf-first-beginframe-"));
  dirs.push(dir);
  const session = await createCaptureSession(
    "http://localhost:0",
    dir,
    { width: 1920, height: 1080, fps: { num: 30, den: 1 }, format: "jpeg" },
    null,
    {},
  );
  session.isInitialized = true;
  session.captureMode = "beginframe";
  session.beginFrameTimeTicks = baseTicks;
  return session;
}

describe("first BeginFrame capture of a session", () => {
  // Measured on Linux headless-shell: without this, a chunk's first frame came back as the
  // frame composited during init (the composition at t=0) in about half the runs.
  it("displays the seek once before the first capture, between the probe tick and the capture tick", async () => {
    const session = await beginFrameSession(2000);
    const interval = session.beginFrameIntervalMs;

    await captureFrameToBuffer(session, 0, 70 / 30);
    await captureFrameToBuffer(session, 1, 71 / 30);

    expect(calls).toEqual([
      `HeadlessExperimental.beginFrame ticks=${2000 - interval / 2} noDisplayUpdates=false`,
      "capture ticks=2000",
      `capture ticks=${2000 + interval}`,
    ]);
    // The producer's liveness probe runs at base - 5 intervals; ticks must stay monotonic.
    expect(2000 - interval / 2).toBeGreaterThan(2000 - 5 * interval);
  });

  it("does it again on a fresh session (worker or retry page)", async () => {
    await captureFrameToBuffer(await beginFrameSession(2000), 0, 0);
    await captureFrameToBuffer(await beginFrameSession(2000), 0, 0);
    expect(calls.filter((c) => c.startsWith("HeadlessExperimental.beginFrame"))).toHaveLength(2);
  });
});
