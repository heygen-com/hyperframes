import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearFfBinaryLookupCache, findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { registerPcmRoutes } from "./pcm";
import { stubAdapter } from "./stubAdapter.test-helpers";

const ffmpeg = findFfBinary("ffmpeg");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(): { app: Hono; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "hf-pcm-route-"));
  dirs.push(dir);
  const app = new Hono();
  registerPcmRoutes(app, stubAdapter(dir));
  return { app, dir };
}

describe("GET /projects/:id/pcm/*", () => {
  it.skipIf(!ffmpeg)("streams the file's first channel at the asked rate", async () => {
    const { app, dir } = project();
    // Left a 440 Hz tone, right silence: the first channel, not a downmix, is what the fx read today.
    execFileSync(ffmpeg ?? "ffmpeg", [
      ...["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2:sample_rate=44100"],
      ...["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "2"],
      ...["-filter_complex", "[0][1]amerge=inputs=2", join(dir, "bed.wav")],
    ]);
    for (const rate of [48_000, 24_000]) {
      const res = await app.request(`http://localhost/projects/p/pcm/bed.wav?rate=${rate}`);
      expect(res.headers.get("x-sample-rate")).toBe(String(rate));
      const samples = new Float32Array(await res.arrayBuffer());
      expect(Math.abs(samples.length - 2 * rate)).toBeLessThan(rate / 100);
      expect(Math.max(...samples.subarray(rate / 2, rate))).toBeGreaterThan(0.1);
    }
  });

  // fails without the fix: beats read one sample-domain mix, so a channel inverted against the other summed to silence
  // and no beats were found where main found them.
  it.skipIf(!ffmpeg)(
    "streams every channel apart for beats, so out-of-phase stereo keeps its sound",
    async () => {
      const { app, dir } = project();
      execFileSync(ffmpeg ?? "ffmpeg", [
        ...["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1:sample_rate=48000"],
        ...[
          "-filter_complex",
          "[0]asplit[l][r];[r]volume=-1[ri];[l][ri]amerge=inputs=2",
          join(dir, "flip.wav"),
        ],
      ]);
      const res = await app.request(
        "http://localhost/projects/p/pcm/flip.wav?rate=48000&channels=all",
      );
      expect(res.headers.get("x-channels")).toBe("2");
      const frames = new Float32Array(await res.arrayBuffer());
      const left = frames.filter((_, i) => i % 2 === 0);
      const sum = frames.filter((_, i) => i % 2 === 0).map((l, i) => l + frames[i * 2 + 1]!);
      expect(Math.max(...left.subarray(12_000, 24_000))).toBeGreaterThan(0.1);
      expect(Math.max(...sum.subarray(12_000, 24_000).map(Math.abs))).toBeLessThan(0.01);
    },
  );

  // fails without the fix: ffmpeg failing partway still ended the body cleanly, and the cut-short samples were read.
  it.skipIf(!ffmpeg || process.platform === "win32")(
    "errors the body when ffmpeg fails partway, never a 200 that ends cleanly",
    async () => {
      const { app, dir } = project();
      execFileSync(ffmpeg ?? "ffmpeg", [
        ...["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1"],
        join(dir, "tone.wav"),
      ]);
      // An ffmpeg that sends some samples, then fails.
      const failing = join(dir, "ffmpeg-fails");
      writeFileSync(failing, "#!/bin/sh\nhead -c 4000 /dev/zero\nexit 1\n", { mode: 0o755 });
      vi.stubEnv("HYPERFRAMES_FFMPEG_PATH", failing);
      clearFfBinaryLookupCache();
      try {
        const res = await app.request("http://localhost/projects/p/pcm/tone.wav?rate=48000");
        expect(res.status).toBe(200);
        await expect(res.arrayBuffer()).rejects.toThrow();
      } finally {
        vi.unstubAllEnvs();
        clearFfBinaryLookupCache();
      }
    },
  );

  it("refuses any rate but the two analysis rates, and any file outside the project", async () => {
    const { app, dir } = project();
    writeFileSync(join(dir, "bed.wav"), "audio");
    expect((await app.request("http://localhost/projects/p/pcm/bed.wav?rate=8000")).status).toBe(
      400,
    );
    expect(
      (await app.request("http://localhost/projects/p/pcm/../../etc/passwd?rate=48000")).status,
    ).toBe(404);
    expect((await app.request("http://localhost/projects/p/pcm/gone.wav?rate=48000")).status).toBe(
      404,
    );
  });
});
