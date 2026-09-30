import { describe, expect, it } from "vitest";
import { parseAudioFxChain, serializeAudioFxChain } from "@hyperframes/core/audio-fx";
import { normalizeHfColorGrading } from "@hyperframes/core/color-grading";
import {
  activeLook,
  activeVoicePreset,
  chainWithVoicePreset,
  clipSpeedSuffix,
  hasCrop,
  isDucked,
  lookAttrValue,
  readClipBadges,
  splitVisibleBadges,
  type ClipToolState,
} from "./clipToolAttrs";

const presetsIn = (raw: string | null) =>
  raw ? [...new Set(parseAudioFxChain(raw).nodes.map((n) => n.fromPreset ?? n.type))] : [];

const handNode = serializeAudioFxChain({
  version: 1,
  nodes: [{ id: "n1", type: "highpass", enabled: true, params: { frequency: 80 } }],
});

describe("voice presets", () => {
  it("writes the chosen preset's nodes and reads it back", () => {
    const raw = chainWithVoicePreset(null, "voice-clean");
    expect(presetsIn(raw)).toEqual(["voice-clean"]);
    expect(activeVoicePreset(raw)).toBe("voice-clean");
  });

  it("is single-choice: picking another menu preset replaces the first", () => {
    const raw = chainWithVoicePreset(chainWithVoicePreset(null, "voice-clean"), "telephone");
    expect(presetsIn(raw)).toEqual(["telephone"]);
  });

  it("None drops the attribute when the chain held only the preset", () => {
    expect(chainWithVoicePreset(chainWithVoicePreset(null, "voice-warm"), null)).toBeNull();
  });

  it("None keeps nodes that are not from a menu preset", () => {
    const withPreset = chainWithVoicePreset(handNode, "voice-broadcast");
    expect(presetsIn(withPreset)).toEqual(["highpass", "voice-broadcast"]);
    expect(chainWithVoicePreset(withPreset, null)).toBe(handNode);
  });

  it("re-applying the same preset keeps one copy", () => {
    const once = chainWithVoicePreset(null, "megaphone");
    const twice = chainWithVoicePreset(once, "megaphone");
    expect(parseAudioFxChain(twice ?? "").nodes).toHaveLength(
      parseAudioFxChain(once ?? "").nodes.length,
    );
  });
});

describe("looks", () => {
  it("writes the minimal preset form the runtime resolves", () => {
    const raw = lookAttrValue("warm-daylight");
    expect(raw).toBe('{"preset":"warm-daylight","intensity":1}');
    expect(normalizeHfColorGrading(JSON.parse(raw ?? ""))?.preset).toBe("warm-daylight");
    expect(activeLook(raw)).toBe("warm-daylight");
  });

  it("None removes the attribute", () => {
    expect(lookAttrValue(null)).toBeNull();
  });

  it("reads a full inspector-written grading and ignores garbage", () => {
    expect(activeLook('{"preset":"mono-clean","intensity":0.4,"adjust":{"contrast":0.2}}')).toBe(
      "mono-clean",
    );
    expect(activeLook("{nope")).toBeNull();
    expect(activeLook('{"preset":"mono-clean","enabled":false}')).toBeNull();
  });
});

describe("small readers", () => {
  it("treats an inset of zero or none as no crop", () => {
    expect(hasCrop("inset(10px 0px 10px 0px)")).toBe(true);
    expect(hasCrop("inset(0px)")).toBe(false);
    expect(hasCrop("none")).toBe(false);
    expect(hasCrop(null)).toBe(false);
  });

  it("reads a carve as ducked unless it is switched off", () => {
    expect(isDucked('{"sources":["vo"]}')).toBe(true);
    expect(isDucked('{"enabled":false,"sources":["vo"]}')).toBe(false);
    expect(isDucked(null)).toBe(false);
  });
});

const baseState: ClipToolState = {
  tag: "video",
  hasSound: true,
  volume: null,
  muted: false,
  fxChain: null,
  automation: null,
  colorGrading: null,
  clipPath: null,
  carve: null,
  link: null,
};

const rampAutomation = JSON.stringify({
  version: 1,
  lanes: [
    {
      target: "rate",
      points: [
        { t: 0, v: 0.5 },
        { t: 2, v: 1 },
      ],
    },
  ],
});

describe("readClipBadges", () => {
  it("shows nothing for a plain clip at 100%", () => {
    expect(readClipBadges(baseState)).toEqual([]);
  });

  it("lists every applied tool in the wireframe's order", () => {
    const labels = readClipBadges({
      ...baseState,
      volume: 1.8,
      fxChain: chainWithVoicePreset(null, "voice-clean"),
      automation: rampAutomation,
      colorGrading: lookAttrValue("warm-daylight"),
      clipPath: "inset(0px 20px)",
      carve: "{}",
      link: "talk",
    }).map((b) => b.label);
    expect(labels).toEqual([
      "Linked",
      "Warm daylight",
      "Voice: Clean",
      "Ramp",
      "Crop",
      "Ducked",
      "180%",
    ]);
  });

  it("badges a muted audio clip but not muted b-roll", () => {
    expect(readClipBadges({ ...baseState, tag: "audio", muted: true })[0]?.label).toBe("Muted");
    expect(readClipBadges({ ...baseState, hasSound: false, muted: true })).toEqual([]);
  });

  it("caps at two visible badges plus the link badge", () => {
    const badges = readClipBadges({
      ...baseState,
      link: "talk",
      colorGrading: lookAttrValue("mono-clean"),
      clipPath: "inset(5px)",
      volume: 0.6,
    });
    const { visible, hidden } = splitVisibleBadges(badges);
    expect(visible.map((b) => b.label)).toEqual(["Linked", "Mono", "Crop"]);
    expect(hidden.map((b) => b.label)).toEqual(["60%"]);
  });
});

describe("clipSpeedSuffix", () => {
  it("shows a constant speed as a percentage and hides 100%", () => {
    expect(clipSpeedSuffix(1.5, null)).toBe(" [150%]");
    expect(clipSpeedSuffix(0.35, null)).toBe(" [35%]");
    expect(clipSpeedSuffix(1, null)).toBe("");
    expect(clipSpeedSuffix(undefined, null)).toBe("");
  });

  it("shows a rate lane as a ramp, whatever the base rate", () => {
    expect(clipSpeedSuffix(2, rampAutomation)).toBe(" [ramp]");
    expect(clipSpeedSuffix(1, rampAutomation)).toBe(" [ramp]");
  });
});
