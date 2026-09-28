import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

it("names the launching app in the feedback env string", async () => {
  vi.stubEnv("HYPERFRAMES_CLIENT", "studio-host/1.2.3/stable");
  const { getDoctorSummary } = await import("./feedback.js");
  expect((await getDoctorSummary()).split(" ")).toContain("client=studio-host/1.2.3/stable");
});
