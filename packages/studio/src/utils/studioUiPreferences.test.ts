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
