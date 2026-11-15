import { describe, expect, it, vi } from "vitest";
import puppeteer from "puppeteer-core";
import { resolveConfig } from "../../../../engine/src/config.js";
import { resolveHeadlessShellPath } from "../../../../engine/src/services/browserManager.js";
import { referenceBackgroundResult } from "../../../../engine/src/services/referenceBackground.js";

const state = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@hyperframes/engine", () => ({
  createCaptureSession: state.create,
  closeCaptureSession: async () => {},
  readReferenceBackground: async () => ({ kind: "solid", rgb: [10, 46, 138] }),
  referenceBackgroundResult,
}));
vi.mock("../fileServer.js", () => ({
  createFileServer: async () => ({ url: "http://inspection.test" }),
  closeFileServerSafely: () => {},
  VIRTUAL_TIME_SHIM: "",
}));
import { readPlanReferenceBackground } from "./planReferenceBackground.js";

const chromePath = resolveHeadlessShellPath();

describe.skipIf(!chromePath)("reference readiness with parked animation frames", () => {
  it("observes readiness after the first check without waiting for a render seek", async () => {
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      vi.spyOn(page, "goto").mockImplementation(async () => {
        await page.setContent(`<script>
          window.rafCalls = 0;
          window.requestAnimationFrame = () => { window.rafCalls++; return 1; };
          const film = { duration: 0, seek: () => {} };
          let first = true;
          Object.defineProperty(window, '__hf', { get() {
            if (first) { first = false; setTimeout(() => { film.duration = 1; }, 50); }
            return film;
          }});
        </script>`);
        return null;
      });
      state.create.mockResolvedValue({ page });
      const result = await readPlanReferenceBackground({
        projectDir: "/project",
        workDir: "/work",
        cfg: resolveConfig({ playerReadyTimeout: 750 }),
        options: { width: 320, height: 240, fps: { num: 30, den: 1 } },
        log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      });
      expect(result).toEqual({ reference_background: { kind: "solid", rgb: [10, 46, 138] } });
      expect(await page.evaluate("window.rafCalls")).toBe(0);
    } finally {
      await browser.close();
    }
  }, 10_000);
});
