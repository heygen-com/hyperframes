import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStudioBooleanEnvFlag } from "./manualEditingAvailability";

async function loadAvailabilityWithEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) vi.stubEnv(key, value);
  }
  return import("./manualEditingAvailability");
}

describe("manual editing availability", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("enables inspector selection and manual dragging by default", async () => {
    const availability = await loadAvailabilityWithEnv({});

    expect(availability.STUDIO_PREVIEW_MANUAL_EDITING_ENABLED).toBe(true);
    expect(availability.STUDIO_PREVIEW_SELECTION_ENABLED).toBe(true);
    expect(availability.STUDIO_INSPECTOR_PANELS_ENABLED).toBe(true);
  });

  it("disables preview selection when the inspector panel flag is explicitly off", async () => {
    const availability = await loadAvailabilityWithEnv({
      VITE_STUDIO_ENABLE_INSPECTOR_PANELS: "0",
    });

    expect(availability.STUDIO_INSPECTOR_PANELS_ENABLED).toBe(false);
    expect(availability.STUDIO_PREVIEW_SELECTION_ENABLED).toBe(false);
  });

  it("enables feature flags with explicit truthy env values", () => {
    expect(
      resolveStudioBooleanEnvFlag(
        { VITE_STUDIO_ENABLE_PREVIEW_MANUAL_DRAGGING: "true" },
        ["VITE_STUDIO_ENABLE_PREVIEW_MANUAL_DRAGGING"],
        false,
      ),
    ).toBe(true);
    expect(
      resolveStudioBooleanEnvFlag(
        { VITE_STUDIO_ENABLE_MOTION_PANEL: "1" },
        ["VITE_STUDIO_ENABLE_MOTION_PANEL"],
        false,
      ),
    ).toBe(true);
  });

  it("disables feature flags with explicit falsy env values", () => {
    expect(
      resolveStudioBooleanEnvFlag(
        { VITE_STUDIO_ENABLE_PREVIEW_MANUAL_DRAGGING: "off" },
        ["VITE_STUDIO_ENABLE_PREVIEW_MANUAL_DRAGGING"],
        true,
      ),
    ).toBe(false);
    expect(
      resolveStudioBooleanEnvFlag(
        { VITE_STUDIO_ENABLE_MOTION_PANEL: "0" },
        ["VITE_STUDIO_ENABLE_MOTION_PANEL"],
        true,
      ),
    ).toBe(false);
  });

  it("supports legacy flag aliases after the preferred name", () => {
    expect(
      resolveStudioBooleanEnvFlag(
        { VITE_STUDIO_PREVIEW_MANUAL_EDITING_ENABLED: "yes" },
        [
          "VITE_STUDIO_ENABLE_PREVIEW_MANUAL_DRAGGING",
          "VITE_STUDIO_PREVIEW_MANUAL_EDITING_ENABLED",
        ],
        false,
      ),
    ).toBe(true);
    expect(
      resolveStudioBooleanEnvFlag(
        { VITE_STUDIO_MOTION_PANEL_ENABLED: "enabled" },
        ["VITE_STUDIO_ENABLE_MOTION_PANEL", "VITE_STUDIO_MOTION_PANEL_ENABLED"],
        false,
      ),
    ).toBe(true);
  });

  it("lets preferred flag values override legacy aliases", () => {
    expect(
      resolveStudioBooleanEnvFlag(
        {
          VITE_STUDIO_ENABLE_INSPECTOR_PANELS: "off",
          VITE_STUDIO_INSPECTOR_PANELS_ENABLED: "on",
        },
        ["VITE_STUDIO_ENABLE_INSPECTOR_PANELS", "VITE_STUDIO_INSPECTOR_PANELS_ENABLED"],
        true,
      ),
    ).toBe(false);
  });

  it("falls back for missing, empty, or unknown env values", () => {
    expect(resolveStudioBooleanEnvFlag({}, ["MISSING"], false)).toBe(false);
    expect(resolveStudioBooleanEnvFlag({ EMPTY: "" }, ["EMPTY"], true)).toBe(true);
    expect(resolveStudioBooleanEnvFlag({ UNKNOWN: "maybe" }, ["UNKNOWN"], false)).toBe(false);
  });
});
