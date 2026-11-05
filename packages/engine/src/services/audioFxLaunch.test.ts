import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const acquire = vi.hoisted(() => vi.fn());
vi.mock("./browserManager.js", async (importActual) => ({
  ...(await importActual<typeof import("./browserManager.js")>()),
  acquireBrowser: acquire,
}));

import { applyAudioFxChain, writeWav } from "./audioFxRender.js";
import { buildChromeArgs } from "./browserManager.js";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("audio effects browser launch", () => {
  it("asks for the shared Chrome args, not its own list", async () => {
    acquire.mockRejectedValue(new Error("stop here"));
    dir = mkdtempSync(join(tmpdir(), "hf-fx-launch-"));
    const input = join(dir, "in.wav");
    writeWav(input, new Float32Array(480), 48000);
    const chain = {
      version: 1 as const,
      nodes: [
        { type: "peaking" as const, enabled: true, params: { frequency: 440, gain: -3, q: 1 } },
      ],
    };
    await expect(
      applyAudioFxChain(input, chain, join(dir, "out.wav"), { trackId: "t" }),
    ).rejects.toThrow();
    expect(acquire).toHaveBeenCalledWith(
      buildChromeArgs(
        { width: 1280, height: 720, captureMode: "screenshot" },
        { browserGpuMode: "software" },
      ),
    );
  });
});
