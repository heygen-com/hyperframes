// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { useVolumeAutomation, type VolumeAutomationBinding } from "./useVolumeAutomation";
import type { DomEditSelection } from "./domEditingTypes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The clip-local playhead time the hook derives is `currentTime - data-start`,
// clamped to `data-duration`: tests that care about it set both attributes.
function bind(dataAttributes: Record<string, string>, currentTime = 0) {
  const onSetAttributeQuiet = vi.fn();
  const captured: { current: VolumeAutomationBinding | null } = { current: null };
  function Probe() {
    captured.current = useVolumeAutomation(
      { dataAttributes } as unknown as DomEditSelection,
      currentTime,
      onSetAttributeQuiet,
    );
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  act(() => {
    createRoot(host).render(<Probe />);
  });
  if (!captured.current) throw new Error("hook never ran");
  return { binding: captured.current, onSetAttributeQuiet };
}

const volumeLane = (v: number) =>
  JSON.stringify({ version: 1, lanes: [{ target: "volume", points: [{ t: 0, v }] }] });

const writtenAutomation = (onSetAttributeQuiet: ReturnType<typeof vi.fn>) =>
  JSON.parse(String(onSetAttributeQuiet.mock.calls[0][1]));

const writtenVolumePoints = (onSetAttributeQuiet: ReturnType<typeof vi.fn>) =>
  writtenAutomation(onSetAttributeQuiet).lanes.find(
    (l: { target: string }) => l.target === "volume",
  ).points;

describe("useVolumeAutomation", () => {
  it("reports an unautomated track", () => {
    expect(bind({ volume: "0.55" }).binding.volumeAutomated).toBe(false);
  });

  it("reports a track with a volume lane", () => {
    expect(bind({ volume: "0.55", automation: volumeLane(0.2) }).binding.volumeAutomated).toBe(
      true,
    );
  });

  it("does not count an FX lane as automating the volume", () => {
    const automation = JSON.stringify({
      version: 1,
      lanes: [{ target: "fx.n1.frequency", points: [{ t: 0, v: 400 }] }],
    });
    expect(bind({ volume: "0.55", automation }).binding.volumeAutomated).toBe(false);
  });

  it("seeds a new lane at the level the slider already shows", () => {
    // Automating a track must not change how loud it is.
    const { binding, onSetAttributeQuiet } = bind({ volume: "0.55" });
    act(() => binding.onAutomateVolume());
    expect(onSetAttributeQuiet).toHaveBeenCalledWith(
      "data-automation",
      JSON.stringify({ version: 1, lanes: [{ target: "volume", points: [{ t: 0, v: 0.55 }] }] }),
    );
  });

  it("treats a missing data-volume as unity", () => {
    const { binding, onSetAttributeQuiet } = bind({});
    act(() => binding.onAutomateVolume());
    expect(writtenAutomation(onSetAttributeQuiet).lanes[0].points[0].v).toBe(1);
  });

  it("keeps FX lanes when adding the volume one", () => {
    const automation = JSON.stringify({
      version: 1,
      lanes: [{ target: "fx.n1.frequency", points: [{ t: 0, v: 400 }] }],
    });
    const { binding, onSetAttributeQuiet } = bind({ volume: "0.4", automation });
    act(() => binding.onAutomateVolume());
    expect(
      writtenAutomation(onSetAttributeQuiet).lanes.map((l: { target: string }) => l.target),
    ).toEqual(["fx.n1.frequency", "volume"]);
  });

  it("deletes only the volume lane", () => {
    const automation = JSON.stringify({
      version: 1,
      lanes: [
        { target: "volume", points: [{ t: 0, v: 0.2 }] },
        { target: "fx.n1.frequency", points: [{ t: 0, v: 400 }] },
      ],
    });
    const { binding, onSetAttributeQuiet } = bind({ volume: "0.4", automation });
    act(() => binding.onRemoveVolumeAutomation());
    expect(
      writtenAutomation(onSetAttributeQuiet).lanes.map((l: { target: string }) => l.target),
    ).toEqual(["fx.n1.frequency"]);
  });

  it("clears the attribute when the volume lane was the only one", () => {
    const { binding, onSetAttributeQuiet } = bind({ volume: "0.4", automation: volumeLane(0.2) });
    act(() => binding.onRemoveVolumeAutomation());
    // Null, not "": the quiet path removes an attribute it is given null for.
    expect(onSetAttributeQuiet).toHaveBeenCalledWith("data-automation", null);
  });

  it("writes a keyframe at the playhead instead of the flat attribute", () => {
    // The slider used to be disabled while automated; this is what replaces
    // that: a commit lands in the envelope, not on `data-volume`.
    const { binding, onSetAttributeQuiet } = bind(
      { volume: "0.4", automation: volumeLane(0.2), start: "0", duration: "10" },
      5,
    );
    act(() => binding.onCommitVolumeAt(0.7));
    expect(writtenVolumePoints(onSetAttributeQuiet)).toEqual([
      { t: 0, v: 0.2 },
      { t: 5, v: 0.7 },
    ]);
  });

  it("clamps the playhead to the clip's own span, not the composition's", () => {
    // A playhead past the clip's end must still land the keyframe at the
    // clip's own last instant, not off the end of its automation lane.
    const { binding, onSetAttributeQuiet } = bind(
      { volume: "0.4", automation: volumeLane(0.2), start: "10", duration: "4" },
      50,
    );
    act(() => binding.onCommitVolumeAt(0.9));
    expect(writtenVolumePoints(onSetAttributeQuiet)).toEqual([
      { t: 0, v: 0.2 },
      { t: 4, v: 0.9 },
    ]);
  });

  it("moves the existing point instead of stacking a new one when committing near it", () => {
    const { binding, onSetAttributeQuiet } = bind(
      { volume: "0.4", automation: volumeLane(0.2), start: "0", duration: "10" },
      0,
    );
    act(() => binding.onCommitVolumeAt(0.9));
    expect(writtenVolumePoints(onSetAttributeQuiet)).toEqual([{ t: 0, v: 0.9 }]);
  });

  it("reports the envelope's own value at the playhead, not the static attribute", () => {
    const { binding } = bind(
      { volume: "0.4", automation: volumeLane(0.2), start: "0", duration: "10" },
      0,
    );
    expect(binding.automatedVolumeValue).toBe(0.2);
  });

  it("translates to clip-local time, not composition time, for a clip that starts mid-timeline", () => {
    // start=10 keeps this inside the clip's own duration either way, so the
    // duration clamp can't mask a missing `currentTime - elStart` subtraction
    // the way start=0 cases elsewhere in this file do.
    const { binding, onSetAttributeQuiet } = bind(
      { volume: "0.4", automation: volumeLane(0.2), start: "10", duration: "20" },
      15,
    );
    act(() => binding.onCommitVolumeAt(0.9));
    expect(writtenVolumePoints(onSetAttributeQuiet)).toEqual([
      { t: 0, v: 0.2 },
      { t: 5, v: 0.9 },
    ]);
  });

  it("reports no automated value when the track is not automated", () => {
    expect(bind({ volume: "0.4" }).binding.automatedVolumeValue).toBeUndefined();
  });

  it("reads an unreadable attribute as no automation", () => {
    expect(bind({ volume: "0.55", automation: "{not json" }).binding.volumeAutomated).toBe(false);
  });

  it("seeds at unity when data-volume is present but empty", () => {
    // Number("") is 0, so `?? "1"` alone seeded the lane at silence while the
    // engine read the same empty attribute as unity.
    const { binding, onSetAttributeQuiet } = bind({ volume: "" });
    act(() => binding.onAutomateVolume());
    expect(writtenAutomation(onSetAttributeQuiet).lanes[0].points[0].v).toBe(1);
  });

  it("seeds at unity when data-volume is not a number", () => {
    const { binding, onSetAttributeQuiet } = bind({ volume: "loud" });
    act(() => binding.onAutomateVolume());
    expect(writtenAutomation(onSetAttributeQuiet).lanes[0].points[0].v).toBe(1);
  });
});
