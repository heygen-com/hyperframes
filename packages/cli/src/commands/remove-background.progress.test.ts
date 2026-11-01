import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoveBackgroundProgress } from "../api/removeBackground.js";

const events: RemoveBackgroundProgress[] = [
  { kind: "info", message: "Loading the model" },
  { kind: "metadata", width: 1076, height: 1928, fps: 24, frameCount: 100 },
  ...Array.from(
    { length: 100 },
    (_, i): RemoveBackgroundProgress => ({
      kind: "frame",
      index: i + 1,
      total: 100,
      avgMsPerFrame: 900,
    }),
  ),
];

vi.mock("../api/removeBackground.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/removeBackground.js")>()),
  removeBackground: vi.fn(
    async (options: { onProgress?: (e: RemoveBackgroundProgress) => void }) => {
      for (const event of events) options.onProgress?.(event);
      return {
        outputPath: "/out/cut.webm",
        framesProcessed: 100,
        durationSeconds: 18,
        avgMsPerFrame: 900,
        provider: "CPU",
        format: "webm",
      };
    },
  ),
}));

async function runJson(): Promise<{ stdout: string[]; stderr: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void stdout.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void stderr.push(a.join(" ")));
  const command = (await import("./remove-background.js")).default as unknown as {
    run: (context: { args: Record<string, unknown> }) => Promise<void>;
  };
  await command.run({
    args: { input: "in.mp4", output: "out.webm", device: "auto", quality: "best", json: true },
  });
  return { stdout, stderr };
}

afterEach(() => vi.restoreAllMocks());

describe("remove-background --json", () => {
  it("keeps stdout to the one result line and streams progress lines on stderr", async () => {
    const { stdout, stderr } = await runJson();
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0]!)).toMatchObject({ ok: true, outputPath: "/out/cut.webm" });
    const progress = stderr.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(progress.length).toBeGreaterThan(2);
    expect(progress.every((line) => line["type"] === "progress")).toBe(true);
    expect(progress.some((line) => line["kind"] === "metadata" && line["width"] === 1076)).toBe(
      true,
    );
    const frames = progress.filter((line) => line["kind"] === "frame");
    expect(frames.at(-1)).toMatchObject({ index: 100, total: 100, avgMsPerFrame: 900 });
  });

  it("does not write a line for every frame", async () => {
    const { stderr } = await runJson();
    const frames = stderr.filter((line) => JSON.parse(line).kind === "frame");
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.length).toBeLessThan(30);
  });
});
