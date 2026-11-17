import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeAudioPeaks } from "../helpers/waveform.js";
import { registerWaveformRoutes } from "./waveform";
import { stubAdapter } from "./stubAdapter.test-helpers";

vi.mock("../helpers/waveform.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../helpers/waveform.js")>()),
  decodeAudioPeaks: vi.fn(async () => [0.3]),
}));

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("GET /projects/:id/waveform/*", () => {
  it("decodes a file once however the request spells its path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-waveform-route-"));
    dirs.push(dir);
    mkdirSync(join(dir, "media"));
    writeFileSync(join(dir, "media", "bed.wav"), "audio");
    const app = new Hono();
    registerWaveformRoutes(app, stubAdapter(dir));

    for (const spelling of ["media/bed.wav", "media//bed.wav", "media/bed.wav/"]) {
      const res = await app.request(`http://localhost/projects/p/waveform/${spelling}`);
      expect(await res.json()).toEqual({ peaks: [0.3] });
    }
    expect(decodeAudioPeaks).toHaveBeenCalledTimes(1);
  });

  it("decodes a file once when several clips ask at the same time", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-waveform-route-"));
    dirs.push(dir);
    writeFileSync(join(dir, "bed.wav"), "audio");
    const app = new Hono();
    registerWaveformRoutes(app, stubAdapter(dir));
    let finish: (peaks: number[]) => void = () => {};
    const decode = vi.mocked(decodeAudioPeaks);
    decode.mockClear();
    decode.mockImplementation(() => new Promise<number[]>((resolve) => (finish = resolve)));

    const both = Promise.all([
      app.request("http://localhost/projects/p/waveform/bed.wav"),
      app.request("http://localhost/projects/p/waveform/bed.wav"),
    ]);
    await vi.waitFor(() => expect(decode).toHaveBeenCalled());
    finish([0.6]);
    for (const res of await both) expect(await res.json()).toEqual({ peaks: [0.6] });
    expect(decode).toHaveBeenCalledTimes(1);
  });
});
