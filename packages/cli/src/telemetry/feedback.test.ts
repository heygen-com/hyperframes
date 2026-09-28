import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

it("names the launching app in the feedback env string", async () => {
  vi.stubEnv("HYPERFRAMES_CLIENT", "desktop/0.8.82/stable");
  const { getDoctorSummary } = await import("./feedback.js");
  expect((await getDoctorSummary()).split(" ")).toContain("client=desktop/0.8.82/stable");
});
