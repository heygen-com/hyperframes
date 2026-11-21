import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { compileForRender } from "./htmlCompiler.js";

type Probe = "probeMediaProfile" | "extractMediaMetadata" | "extractAudioMetadata";
const probes = vi.hoisted(() => ({
  hang: "probeMediaProfile" as string,
  calls: [] as { name: string; signal?: AbortSignal }[],
}));
const answer = (name: string, signal: AbortSignal | undefined, value: unknown) => {
  probes.calls.push({ name, signal });
  if (name !== probes.hang) return Promise.resolve(value);
  // A source that never answers: only an abort settles the probe.
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
};
vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  assertMediaPayload: async () => {},
  probeMediaProfile: (_path: string, options?: { signal?: AbortSignal }) =>
    answer("probeMediaProfile", options?.signal, {
      hasVideoStream: true,
      hasAudioStream: true,
      visualKind: "moving",
    }),
  extractMediaMetadata: (_path: string, options?: { signal?: AbortSignal }) =>
    answer("extractMediaMetadata", options?.signal, { durationSeconds: 1 }),
  extractAudioMetadata: (_path: string, options?: { signal?: AbortSignal }) =>
    answer("extractAudioMetadata", options?.signal, { durationSeconds: 1 }),
}));

const dirs: string[] = [];
afterEach(() => {
  probes.calls.length = 0;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const cases: [Probe, string][] = [
  ["probeMediaProfile", "video"],
  ["extractMediaMetadata", "video"],
  ["extractAudioMetadata", "audio"],
];

// fails without the fix: a source probed in place at its URL was probed with no signal, so a cancel waited on it.
it.each(cases)(
  "a cancel during %s of a %s probed in place stops the compile",
  async (probe, tag) => {
    probes.hang = probe;
    const dir = mkdtempSync(join(tmpdir(), "hf-probe-cancel-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html><html><head></head><body><main data-composition-id="root" data-start="0" data-duration="1" data-width="16" data-height="16"><${tag} muted src="clip.mp4" data-start="0" data-track-index="0"></${tag}></main></body></html>`,
    );
    const cancel = new AbortController();
    const compile = compileForRender(dir, join(dir, "index.html"), join(dir, "out"), {
      allowSystemFontCapture: false,
      abortSignal: cancel.signal,
      urlByAbsentLocalPath: new Map([
        [join(dir, "clip.mp4"), "https://media.example.com/clip.mp4"],
      ]),
    });
    compile.catch(() => {});
    await vi.waitFor(() => expect(probes.calls.some((call) => call.name === probe)).toBe(true));
    expect(probes.calls.every((call) => call.signal && !call.signal.aborted)).toBe(true);
    cancel.abort(new Error("render cancelled"));
    expect(probes.calls.every((call) => call.signal?.aborted)).toBe(true);

    await expect(compile).rejects.toThrow("render cancelled");
  },
);
