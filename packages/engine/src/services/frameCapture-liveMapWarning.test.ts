import { describe, expect, it } from "vitest";
import { buildLiveMapWarning } from "./frameCapture.js";

describe("buildLiveMapWarning", () => {
  it("names every detected map library in the message and details", () => {
    const warning = buildLiveMapWarning(["Leaflet", "MapLibre GL"]);
    expect(warning.code).toBe("live_map_detected");
    expect(warning.message).toContain("Leaflet, MapLibre GL");
    expect(warning.details?.sources).toEqual(["Leaflet", "MapLibre GL"]);
  });

  it("points the author at the bake pipeline instead of just describing the failure", () => {
    const warning = buildLiveMapWarning(["Leaflet"]);
    expect(warning.message).toContain("bake-basemap.mjs");
    expect(warning.message).toContain("deterministic-render");
  });

  it("copies the libraries array so later mutation cannot alter the recorded warning", () => {
    const libraries = ["Leaflet"];
    const warning = buildLiveMapWarning(libraries);
    libraries.push("Mapbox GL");
    expect(warning.details?.sources).toEqual(["Leaflet"]);
  });
});
