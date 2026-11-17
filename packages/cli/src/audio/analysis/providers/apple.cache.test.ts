import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const run = vi.hoisted(() =>
  vi.fn(async (command: string, args: string[]) => {
    if (command === "xcrun") {
      const output = args[args.indexOf("-o") + 1];
      if (!output) throw new Error("compiler output was not specified");
      writeFileSync(output, "helper");
    }
    return { stdout: '{"tags":[]}' };
  }),
);
vi.mock("./shared.js", () => ({
  AVAILABLE: { ok: true },
  unavailable: (reason: string) => ({ ok: false, reason }),
  runFile: run,
  withWavFile: (_signal: unknown, use: (path: string) => Promise<unknown>) => use("fake.wav"),
}));
let root: string;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  run.mockClear();
  if (root) rmSync(root, { recursive: true, force: true });
});
it.skipIf(process.platform === "win32")(
  "never compiles with a module cache linked outside its root",
  async () => {
    root = mkdtempSync(join(tmpdir(), "hf-apple-cache-"));
    const cache = join(root, "cache");
    const outside = join(root, "outside");
    mkdirSync(join(cache, "audio-helpers"), { recursive: true });
    mkdirSync(outside);
    symlinkSync(outside, join(cache, "audio-helpers", "module-cache"));
    vi.stubEnv("HYPERFRAMES_CACHE_DIR", cache);
    const { appleSoundProvider } = await import("./apple.js");
    await expect(
      appleSoundProvider.analyze(
        "describe",
        {
          sampleRate: 8000,
          channels: [new Float32Array(8000)],
        },
        {},
      ),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  },
);
