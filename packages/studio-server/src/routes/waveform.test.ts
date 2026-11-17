import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { buildWaveformCacheKey, decodeAudioPeaks } from "../helpers/waveform.js";
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
  describe.skipIf(process.platform === "win32")("a cache entry the project ships", () => {
    function projectWithCacheEntry(): { dir: string; entry: string; outside: string } {
      const dir = mkdtempSync(join(tmpdir(), "hf-waveform-route-"));
      const elsewhere = mkdtempSync(join(tmpdir(), "hf-waveform-outside-"));
      dirs.push(dir, elsewhere);
      writeFileSync(join(dir, "bed.wav"), "audio");
      mkdirSync(join(dir, ".waveform-cache"));
      const outside = join(elsewhere, "credentials.json");
      writeFileSync(outside, JSON.stringify({ token: "secret-token" }));
      const key = buildWaveformCacheKey("bed.wav", statSync(join(dir, "bed.wav")));
      return { dir, entry: join(dir, ".waveform-cache", key), outside };
    }

    it("decodes again instead of reading through a link at the entry", async () => {
      const { dir, entry, outside } = projectWithCacheEntry();
      symlinkSync(outside, entry);
      vi.mocked(decodeAudioPeaks).mockImplementation(async () => [0.4]);
      const app = new Hono();
      registerWaveformRoutes(app, stubAdapter(dir));

      const body = await (await app.request("http://localhost/projects/p/waveform/bed.wav")).text();
      expect(body).not.toContain("secret-token");
      expect(JSON.parse(body)).toEqual({ peaks: [0.4] });
    });

    it("decodes again when the cache folder is a link", async () => {
      const { dir, entry, outside } = projectWithCacheEntry();
      rmSync(join(dir, ".waveform-cache"), { recursive: true });
      const linkedFolder = join(outside, "..", "cache");
      mkdirSync(linkedFolder);
      writeFileSync(join(linkedFolder, basename(entry)), "[0.9]");
      symlinkSync(linkedFolder, join(dir, ".waveform-cache"));
      vi.mocked(decodeAudioPeaks).mockImplementation(async () => [0.4]);
      const app = new Hono();
      registerWaveformRoutes(app, stubAdapter(dir));

      const res = await app.request("http://localhost/projects/p/waveform/bed.wav");
      expect(await res.json()).toEqual({ peaks: [0.4] });
    });

    it("decodes again when a plain entry holds anything but numbers", async () => {
      const { dir, entry } = projectWithCacheEntry();
      writeFileSync(entry, JSON.stringify({ token: "secret-token" }));
      vi.mocked(decodeAudioPeaks).mockImplementation(async () => [0.4]);
      const app = new Hono();
      registerWaveformRoutes(app, stubAdapter(dir));

      const res = await app.request("http://localhost/projects/p/waveform/bed.wav");
      expect(await res.json()).toEqual({ peaks: [0.4] });
    });
  });
});
