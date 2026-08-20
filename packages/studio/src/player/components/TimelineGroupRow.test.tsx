// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineGroupRow } from "./TimelineGroupRow";
import { TimelineEditProvider } from "../../contexts/TimelineEditContext";
import { defaultTimelineTheme } from "./timelineTheme";
import type { TimelineTrackGroupInfo } from "./useTimelineTrackDerivations";
import type { TimelineElement } from "../store/playerStore";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../telemetry/canary", () => ({ isCanaryEnabled: () => true }));

afterEach(() => {
  document.body.innerHTML = "";
});

const member = (id: string, track: number): TimelineElement => ({
  id,
  domId: id,
  tag: "audio",
  start: 0,
  duration: 5,
  track,
  audioGroup: "voiceover",
});

const GROUP: TimelineTrackGroupInfo = {
  id: "voiceover",
  label: "Voiceover",
  anchorKey: -0.5,
  memberTracks: [0, 1],
  memberElements: [member("vo-1", 0), member("vo-2", 1)],
  volume: 1,
  hidden: false,
};

function renderRow(overrides: Partial<TimelineTrackGroupInfo> = {}) {
  const onSetAudioGroupAttributeQuiet = vi.fn();
  const onSetElementAttributeQuiet = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  act(() =>
    createRoot(host).render(
      <TimelineEditProvider value={{ onSetAudioGroupAttributeQuiet, onSetElementAttributeQuiet }}>
        <TimelineGroupRow
          index={0}
          rowKey={0}
          group={{ ...GROUP, ...overrides }}
          logicalRow={{ id: "g", level: 1, kind: "track" } as never}
          top={0}
          height={48}
          virtualized={false}
          contentOrigin={232}
          theme={defaultTimelineTheme}
          collapsedGroupIds={new Set()}
          toggleGroupExpanded={vi.fn()}
          lanes={{ bind: () => ({ lanes: [] }) } as never}
          pps={10}
          currentTime={0}
          compositionDuration={60}
          contentGutter={0}
          trackContentWidth={800}
        />
      </TimelineEditProvider>,
    ),
  );
  return { host, onSetAudioGroupAttributeQuiet, onSetElementAttributeQuiet };
}

describe("TimelineGroupRow", () => {
  // C1 names this as the step's own definition of done: "opening the popover on
  // a GROUP and applying a preset results in exactly ONE `data-fx-chain` write,
  // on the group element, and zero writes on members". A group IS a bus — a
  // write that fanned out to the members would be batch-apply wearing a bus's
  // clothes, which is the one thing §1 rules out.
  it("applies a preset to the group element only, never to its members", () => {
    const { host, onSetAudioGroupAttributeQuiet, onSetElementAttributeQuiet } = renderRow();
    const fx = Array.from(host.querySelectorAll("button")).find((b) =>
      b.getAttribute("aria-label")?.startsWith("Effects"),
    );
    act(() => fx?.click());
    const preset = document.querySelector<HTMLButtonElement>(".hf-fx-preset-item");
    act(() => preset?.click());

    expect(onSetAudioGroupAttributeQuiet).toHaveBeenCalledTimes(1);
    const [groupId, attr] = onSetAudioGroupAttributeQuiet.mock.calls[0] ?? [];
    expect(groupId).toBe("voiceover");
    expect(attr).toBe("data-fx-chain");
    // The members are the point: not one write reaches them.
    expect(onSetElementAttributeQuiet).not.toHaveBeenCalled();
  });

  // Automation lanes are always drawn, so there is no toggle to offer: the
  // group's row shows its envelopes the way it shows its name. (This replaced a
  // rule that hid the toggle when the count was zero — the toggle itself is
  // gone now.)
  it("renders no lane disclosure on the group header", () => {
    const { host } = renderRow({
      fxChain: JSON.stringify({
        version: 1,
        nodes: [{ type: "peaking", id: "p1", params: { frequency: 1000, gain: -3, q: 1 } }],
      }),
      automation: JSON.stringify({
        version: 1,
        lanes: [{ target: "fx.p1.gain", points: [{ t: 0, v: 0 }] }],
      }),
    });
    const laneToggle = Array.from(host.querySelectorAll("button")).find((b) =>
      /lanes$/.test(b.getAttribute("aria-label") ?? ""),
    );
    expect(laneToggle).toBeUndefined();
  });
});
