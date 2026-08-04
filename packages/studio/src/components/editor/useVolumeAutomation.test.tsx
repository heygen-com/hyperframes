// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { useVolumeAutomation, type VolumeAutomationBinding } from "./useVolumeAutomation";
import type { DomEditSelection } from "./domEditingTypes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function bind(dataAttributes: Record<string, string>) {
  const onSetAttribute = vi.fn();
  const captured: { current: VolumeAutomationBinding | null } = { current: null };
  function Probe() {
    captured.current = useVolumeAutomation(
      { dataAttributes } as unknown as DomEditSelection,
      onSetAttribute,
    );
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  act(() => {
    createRoot(host).render(<Probe />);
  });
  if (!captured.current) throw new Error("hook never ran");
  return { binding: captured.current, onSetAttribute };
}

const volumeLane = (v: number) =>
  JSON.stringify({ version: 1, lanes: [{ target: "volume", points: [{ t: 0, v }] }] });

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
    const { binding, onSetAttribute } = bind({ volume: "0.55" });
    act(() => binding.onAutomateVolume());
    expect(onSetAttribute).toHaveBeenCalledWith(
      "data-automation",
      JSON.stringify({ version: 1, lanes: [{ target: "volume", points: [{ t: 0, v: 0.55 }] }] }),
    );
  });

  it("treats a missing data-volume as unity", () => {
    const { binding, onSetAttribute } = bind({});
    act(() => binding.onAutomateVolume());
    expect(JSON.parse(String(onSetAttribute.mock.calls[0][1])).lanes[0].points[0].v).toBe(1);
  });

  it("keeps FX lanes when adding the volume one", () => {
    const automation = JSON.stringify({
      version: 1,
      lanes: [{ target: "fx.n1.frequency", points: [{ t: 0, v: 400 }] }],
    });
    const { binding, onSetAttribute } = bind({ volume: "0.4", automation });
    act(() => binding.onAutomateVolume());
    expect(
      JSON.parse(String(onSetAttribute.mock.calls[0][1])).lanes.map(
        (l: { target: string }) => l.target,
      ),
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
    const { binding, onSetAttribute } = bind({ volume: "0.4", automation });
    act(() => binding.onRemoveVolumeAutomation());
    expect(
      JSON.parse(String(onSetAttribute.mock.calls[0][1])).lanes.map(
        (l: { target: string }) => l.target,
      ),
    ).toEqual(["fx.n1.frequency"]);
  });

  it("clears the attribute when the volume lane was the only one", () => {
    const { binding, onSetAttribute } = bind({ volume: "0.4", automation: volumeLane(0.2) });
    act(() => binding.onRemoveVolumeAutomation());
    expect(onSetAttribute).toHaveBeenCalledWith("data-automation", "");
  });

  it("reads an unreadable attribute as no automation", () => {
    expect(bind({ volume: "0.55", automation: "{not json" }).binding.volumeAutomated).toBe(false);
  });
});
