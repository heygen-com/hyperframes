import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  // Never settles: waiting on it would hang the command.
  flush: vi.fn(() => new Promise<void>(() => {})),
  submitFeedback: vi.fn(async () => {}),
  submitCatalogSearchMiss: vi.fn(async () => {}),
}));
vi.mock("../telemetry/client.js", () => ({ shouldTrack: () => true, flush: mocks.flush }));
vi.mock("../telemetry/events.js", () => ({
  trackCatalogSearchMiss: vi.fn(),
  trackRenderFeedback: vi.fn(),
}));
vi.mock("../telemetry/feedback.js", () => ({ getDoctorSummary: async () => "" }));
vi.mock("../telemetry/config.js", () => ({ readConfig: () => ({ anonymousId: "a" }) }));
vi.mock("../utils/submitFeedback.js", () => ({
  submitFeedback: mocks.submitFeedback,
  submitCatalogSearchMiss: mocks.submitCatalogSearchMiss,
}));

it.each([
  ["a rating", { rating: "8" }, mocks.submitFeedback],
  ["a catalog search miss", { "search-miss": "typewriter" }, mocks.submitCatalogSearchMiss],
])("sends %s without waiting on the telemetry upload", async (_, args, submit) => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const { default: feedback } = await import("./feedback.js");
  await feedback.run?.({ args } as never);
  expect(submit).toHaveBeenCalled();
});
