import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { signalProvider, type AudioSignal } from "@hyperframes/core/audio-analysis";
import { analyzeSignal } from "../analyze.js";
import { appleMuProvider, appleSoundProvider, swiftcArgs } from "./apple.js";
import { beatThisProvider } from "./beatThis.js";

const dir = mkdtempSync(join(tmpdir(), "hf-providers-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const tone: AudioSignal = {
  sampleRate: 8000,
  channels: [Float32Array.from({ length: 8000 * 2 }, (_, i) => 0.3 * Math.sin(i / 3))],
};

/** Stands in for a Python with beat_this: answers the package probe, and tracks only a real WAV with real weights. */
function fakePython(hasPackage: boolean): string {
  const path = join(dir, hasPackage ? "python" : "python-bare");
  writeFileSync(
    path,
    `#!/bin/sh
case "$2" in *find_spec*) exit ${hasPackage ? 0 : 1};; esac
[ -f "$3" ] && [ -f "$4" ] || exit 2
head -c 4 "$3" | grep -q RIFF || exit 3
echo "loading weights"
echo '{"beats": [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5], "downbeats": [0.5, 2.5, 4.5]}'
`,
  );
  chmodSync(path, 0o755);
  return path;
}

const weights = join(dir, "beat_this-small0.ckpt");
writeFileSync(weights, "weights");

afterEach(() => {
  delete process.env.HYPERFRAMES_BEAT_THIS_PYTHON;
  delete process.env.HYPERFRAMES_BEAT_THIS_CHECKPOINT;
});

describe.skipIf(process.platform === "win32")("beatThisProvider", () => {
  it("is unavailable until a Python with beat_this and the weights are both on this machine", async () => {
    expect(await beatThisProvider.available!()).toEqual({
      ok: false,
      reason: "HYPERFRAMES_BEAT_THIS_PYTHON is not set",
    });
    process.env.HYPERFRAMES_BEAT_THIS_PYTHON = join(dir, "missing");
    expect(await beatThisProvider.available!()).toMatchObject({
      reason: "HYPERFRAMES_BEAT_THIS_PYTHON names no file",
    });
    process.env.HYPERFRAMES_BEAT_THIS_PYTHON = fakePython(true);
    process.env.HYPERFRAMES_BEAT_THIS_CHECKPOINT = join(dir, "absent.ckpt");
    expect(await beatThisProvider.available!()).toMatchObject({
      reason: expect.stringContaining("no Beat This! weights"),
    });
    process.env.HYPERFRAMES_BEAT_THIS_CHECKPOINT = weights;
    expect(await beatThisProvider.available!()).toEqual({ ok: true });
    process.env.HYPERFRAMES_BEAT_THIS_PYTHON = fakePython(false);
    expect(await beatThisProvider.available!()).toMatchObject({
      reason: expect.stringContaining("beat_this is not installed"),
    });
  });

  it("answers beats and downbeats from one run, with the meter from beats per bar", async () => {
    process.env.HYPERFRAMES_BEAT_THIS_PYTHON = fakePython(true);
    process.env.HYPERFRAMES_BEAT_THIS_CHECKPOINT = weights;
    const analysis = await analyzeSignal(tone, { capabilities: ["beats", "downbeats", "bpm"] }, [
      beatThisProvider,
      signalProvider,
    ]);
    expect(analysis.provenance).toEqual({
      beats: "beat-this",
      downbeats: "beat-this",
      bpm: "beat-this",
    });
    expect(analysis.values.downbeats).toMatchObject({ times: [0.5, 2.5, 4.5], meter: 4 });
    expect((analysis.values.downbeats as { unheard: boolean[] }).unheard).toHaveLength(3);
    expect(analysis.values.bpm).toMatchObject({ value: 120 });
  });

  it("falls through to signal processing when its run fails", async () => {
    const crashing = join(dir, "python-crashing");
    writeFileSync(
      crashing,
      `#!/bin/sh\ncase "$2" in *find_spec*) exit 0;; esac\necho "out of memory" >&2\nexit 1\n`,
    );
    chmodSync(crashing, 0o755);
    process.env.HYPERFRAMES_BEAT_THIS_PYTHON = crashing;
    process.env.HYPERFRAMES_BEAT_THIS_CHECKPOINT = weights;
    const silent = { ...tone, channels: [new Float32Array(8000 * 7)] };
    const analysis = await analyzeSignal(silent, { capabilities: ["beats"] }, [
      beatThisProvider,
      signalProvider,
    ]);
    expect(analysis.provenance.beats).toBe("signal");
    expect(analysis.warnings[0]).toMatch(
      /^beats: used signal; beat-this failed \(.*out of memory/s,
    );
  });
});

describe("appleMuProvider", () => {
  it("says why it cannot run instead of answering", async () => {
    const availability = await appleMuProvider.available!();
    expect(availability.ok).toBe(false);
    if (!availability.ok)
      expect(availability.reason).toMatch(
        process.platform === "darwin" ? /Music Understanding/ : /^macOS only$/,
      );
  });
});

describe("appleSoundProvider", () => {
  it("builds its helper with a module cache beside the helper, where an agent's sandbox may write", () => {
    const args = swiftcArgs("/cache/helper.swift", "/cache/helper.tmp");
    const cache = args[args.indexOf("-module-cache-path") + 1]!;
    expect(cache).toMatch(/[/\\]\.cache[/\\]hyperframes[/\\]audio-helpers[/\\]module-cache$/);
    expect(args.slice(-3)).toEqual(["/cache/helper.swift", "-o", "/cache/helper.tmp"]);
  });

  it("is unavailable off macOS", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "linux" });
    try {
      expect(await appleSoundProvider.available!()).toEqual({ ok: false, reason: "macOS only" });
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it.skipIf(process.platform !== "darwin")(
    "labels what a short sound holds, using the built-in classifier",
    async () => {
      if (!(await appleSoundProvider.available!()).ok) return;
      const value = (await appleSoundProvider.analyze("describe", tone, {})) as {
        tags: { label: string; score: number }[];
      };
      expect(value.tags.length).toBeGreaterThan(0);
      for (const tag of value.tags) expect(tag.score).toBeGreaterThan(0);
    },
    300_000,
  );
});
