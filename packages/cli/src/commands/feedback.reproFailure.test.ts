import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

vi.mock("../telemetry/client.js", () => ({ shouldTrack: () => true, flush: async () => {} }));
vi.mock("../telemetry/events.js", () => ({
  trackCatalogSearchMiss: vi.fn(),
  trackFeedbackComment: vi.fn(),
  trackRenderFeedback: vi.fn(),
}));
vi.mock("../telemetry/feedback.js", () => ({ getDoctorSummary: async () => "os=test" }));
vi.mock("../telemetry/config.js", () => ({ readConfig: () => ({ anonymousId: "a" }) }));
vi.mock("../telemetry/uploadLeftOut.js", () => ({ trackUploadLeftOut: vi.fn() }));
vi.mock("../utils/submitFeedback.js", () => ({
  submitFeedback: async () => {},
  submitCatalogSearchMiss: async () => {},
}));
vi.mock("open", () => ({ default: async () => {} }));
vi.mock("../utils/publishProject.js", () => ({
  createPublishArchive: () => ({}),
  publishProjectArchive: async () => {
    throw new Error("Upload refused: scenes/a\u001b[2Jb.html\nTry again later");
  },
}));

// fails without the fix: the publish failure reached the terminal with its control characters live.
it("prints a publish failure's control characters as visible escapes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-feedback-repro-"));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const { default: feedback } = await import("./feedback.js");
    await feedback.run?.({ args: { rating: "8", "file-issue": true, yes: true, dir } } as never);
    expect(error.mock.calls.map((call) => call.join(" "))).toEqual([
      "  Upload refused: scenes/a\\x1b[2Jb.html\nTry again later",
    ]);
  } finally {
    log.mockRestore();
    error.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});
