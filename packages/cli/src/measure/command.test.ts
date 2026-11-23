import { describe, expect, it, vi } from "vitest";
import { runMeasure } from "./command.js";
import { Fix } from "./media.js";

describe("runMeasure", () => {
  it("keeps the real error as the failure's cause, so telemetry reports it", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const real = new Error("ffmpeg: no video stream");
    const thrown = await runMeasure(() => {
      throw real;
    }).catch((err: unknown) => err);
    log.mockRestore();
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown instanceof Error && thrown.cause).toBe(real);
  });

  it("prints a refusal's page link in its own url field", async () => {
    const lines: string[] = [];
    const log = vi
      .spyOn(console, "log")
      .mockImplementation((line: string) => void lines.push(line));
    await runMeasure(() => {
      throw new Fix("Pro feature", "Subscribe: https://p.test/pricing", "https://p.test/pricing");
    }).catch(() => undefined);
    log.mockRestore();
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      ok: false,
      fix: "Subscribe: https://p.test/pricing",
      url: "https://p.test/pricing",
    });
  });
});
