import { describe, expect, it, vi } from "vitest";
import { runMeasure } from "./command.js";

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
});
