import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCaptureSession, createStaticVerificationPage } from "./frameCapture.js";

// Each page records what it was asked to do; `goto` stops the setup there.
const calls: string[] = [];
const fakePage = () => ({
  mainFrame: () => ({}),
  on: () => {},
  close: async () => {},
  goto: async () => {
    calls.push("goto");
    throw new Error("stop at navigation");
  },
  createCDPSession: async () => ({
    on: () => {},
    send: async (method: string, params?: { patterns?: { urlPattern: string }[] }) => {
      if (method === "Fetch.enable" && params?.patterns?.[0]?.urlPattern === "*") {
        calls.push("filter");
      }
      return {};
    },
  }),
  evaluateOnNewDocument: async () => {},
  setViewport: async () => {},
  evaluate: async () => undefined,
});

vi.mock("./browserManager.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./browserManager.js")>()),
  resolveBrowserGpuMode: async () => "software",
  acquireBrowser: async () => ({
    captureMode: "screenshot",
    browser: { version: async () => "Chrome/150.0.0.0", newPage: async () => fakePage() },
  }),
}));

const dirs: string[] = [];
afterEach(() => {
  calls.length = 0;
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function openPages(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "hf-page-network-"));
  dirs.push(dir);
  const session = await createCaptureSession(
    "http://localhost:4321",
    dir,
    { width: 320, height: 180, fps: { num: 30, den: 1 }, format: "jpeg" },
    null,
    { forceScreenshot: true },
  );
  calls.push("session page ready");
  await expect(createStaticVerificationPage(session)).rejects.toThrow("stop at navigation");
}

describe("render page address rules", () => {
  it("guard every composition page before it navigates on a restricted host", async () => {
    vi.stubEnv("PRODUCER_RESTRICT_PAGE_NETWORK", "true");
    await openPages();
    expect(calls).toEqual(["filter", "session page ready", "filter", "goto"]);
  });

  it("leave local renders alone", async () => {
    vi.stubEnv("PRODUCER_RESTRICT_PAGE_NETWORK", "");
    await openPages();
    expect(calls).toEqual(["session page ready", "goto"]);
  });
});
