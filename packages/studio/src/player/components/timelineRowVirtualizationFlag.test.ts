import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("timeline row virtualization flag", () => {
  it("enables virtualization by default", async () => {
    const { STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED } =
      await import("./timelineRowVirtualizationFlag");

    expect(STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED).toBe(true);
  });

  it("keeps an explicit rollback path", async () => {
    vi.stubEnv("VITE_STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED", "0");
    const { STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED } =
      await import("./timelineRowVirtualizationFlag");

    expect(STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED).toBe(false);
  });
});
