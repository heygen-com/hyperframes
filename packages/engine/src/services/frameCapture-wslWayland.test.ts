import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCaptureSession } from "./frameCapture.js";

const launches: { withoutWaylandDisplay?: boolean }[] = [];
let gpuNeedsNoWayland = false;

vi.mock("./browserManager.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./browserManager.js")>()),
  resolveBrowserGpuMode: async () => "hardware",
  captureWithoutWaylandDisplay: async () => gpuNeedsNoWayland,
  acquireBrowser: async (_args: string[], config?: { withoutWaylandDisplay?: boolean }) => {
    launches.push({ withoutWaylandDisplay: config?.withoutWaylandDisplay });
    throw new Error("launch recorded");
  },
}));

const dirs: string[] = [];
afterEach(() => {
  launches.length = 0;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function launchCapture() {
  const dir = mkdtempSync(join(tmpdir(), "hf-wsl-wayland-"));
  dirs.push(dir);
  await expect(
    createCaptureSession(
      "http://localhost:0",
      dir,
      { width: 640, height: 360, fps: { num: 30, den: 1 }, format: "jpeg", requiresWebGpu: false },
      null,
      { browserGpuMode: "auto" },
    ),
  ).rejects.toThrow("launch recorded");
  return launches.at(-1)!;
}

// heygen-com/hyperframes#5548: the render browser starts the way the GPU probe reached the GPU.
describe("capture session under WSL", () => {
  it("launches without WAYLAND_DISPLAY when the GPU probe needed that", async () => {
    gpuNeedsNoWayland = true;
    expect((await launchCapture()).withoutWaylandDisplay).toBe(true);
  });

  it("keeps the inherited environment otherwise", async () => {
    gpuNeedsNoWayland = false;
    expect((await launchCapture()).withoutWaylandDisplay).toBe(false);
  });
});
