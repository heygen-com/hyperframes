import { describe, expect, it } from "vitest";
import { readStudioUiPreferences, writeStudioUiPreferences } from "./studioUiPreferences";

function createStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key) => entries.delete(key),
    setItem: (key, value) => entries.set(key, value),
  };
}

describe("studio UI preferences", () => {
  it("merges preference patches into one localStorage entry", () => {
    const storage = createStorage();

    writeStudioUiPreferences({ timelineVisible: false }, storage);
    writeStudioUiPreferences({ playbackRate: 1.5 }, storage);
    writeStudioUiPreferences({ audioMuted: true }, storage);
    writeStudioUiPreferences({ previewZoom: { zoomPercent: 160, panX: -20, panY: 12 } }, storage);

    expect(readStudioUiPreferences(storage)).toEqual({
      timelineVisible: false,
      playbackRate: 1.5,
      audioMuted: true,
      previewZoom: { zoomPercent: 160, panX: -20, panY: 12 },
    });
  });

  it("ignores malformed stored values", () => {
    const storage = createStorage();
    storage.setItem(
      "hf-studio-ui-preferences",
      JSON.stringify({
        leftCollapsed: "yes",
        timelineVisible: true,
        playbackRate: Number.NaN,
        audioMuted: "false",
        previewZoom: { zoomPercent: 150, panX: 0, panY: "bad" },
      }),
    );

    expect(readStudioUiPreferences(storage)).toEqual({
      timelineVisible: true,
    });
  });
});

describe("timelineSnapEnabled preference", () => {
  it("round-trips through storage", () => {
    const storage = createStorage();
    writeStudioUiPreferences({ timelineSnapEnabled: false }, storage);
    expect(readStudioUiPreferences(storage).timelineSnapEnabled).toBe(false);
  });

  it("ignores non-boolean values", () => {
    const storage = createStorage();
    storage.setItem("hf-studio-ui-preferences", JSON.stringify({ timelineSnapEnabled: "yes" }));
    expect(readStudioUiPreferences(storage).timelineSnapEnabled).toBeUndefined();
  });
});

describe("timeline zoom pin persistence", () => {
  it("round-trips a pinned manual zoom (survives the post-edit reload)", () => {
    const storage = createStorage();
    writeStudioUiPreferences(
      { timelineZoomMode: "manual", timelineManualZoomPercent: 250 },
      storage,
    );
    const prefs = readStudioUiPreferences(storage);
    expect(prefs.timelineZoomMode).toBe("manual");
    expect(prefs.timelineManualZoomPercent).toBe(250);
  });

  it("ignores an invalid zoom mode and a non-finite percent", () => {
    const storage = createStorage();
    storage.setItem(
      "hf-studio-ui-preferences",
      JSON.stringify({ timelineZoomMode: "zoomy", timelineManualZoomPercent: "big" }),
    );
    const prefs = readStudioUiPreferences(storage);
    expect(prefs.timelineZoomMode).toBeUndefined();
    expect(prefs.timelineManualZoomPercent).toBeUndefined();
  });
});

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe("pinnedGroupsByElementType", () => {
  it("round-trips a per-element-type pin map", () => {
    const storage = fakeStorage();
    writeStudioUiPreferences(
      { pinnedGroupsByElementType: { text: ["motion"], media: ["grade"] } },
      storage,
    );
    const read = readStudioUiPreferences(storage);
    expect(read.pinnedGroupsByElementType).toEqual({ text: ["motion"], media: ["grade"] });
  });

  it("ignores a malformed pinnedGroupsByElementType (non-object, or non-string-array values)", () => {
    const storage = fakeStorage();
    storage.setItem(
      "hf-studio-ui-preferences",
      JSON.stringify({ pinnedGroupsByElementType: { text: "not-an-array", media: [1, 2] } }),
    );
    const read = readStudioUiPreferences(storage);
    expect(read.pinnedGroupsByElementType).toEqual({ media: [] });
  });

  it("merges a pin-map patch without clobbering other preferences", () => {
    const storage = fakeStorage();
    writeStudioUiPreferences({ audioMuted: true }, storage);
    writeStudioUiPreferences({ pinnedGroupsByElementType: { text: ["style"] } }, storage);
    const read = readStudioUiPreferences(storage);
    expect(read.audioMuted).toBe(true);
    expect(read.pinnedGroupsByElementType).toEqual({ text: ["style"] });
  });
});
