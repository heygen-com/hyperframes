// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { liveTime, usePlayerStore } from "../store/playerStore";
import { PlayerControls } from "./PlayerControls";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  usePlayerStore.setState({
    isPlaying: true,
    currentTime: 2,
    duration: 30,
    timeDisplayMode: "time",
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(React.createElement(PlayerControls, { onTogglePlay: () => {}, onSeek: () => {} })),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("PlayerControls timecode", () => {
  it("rewrites the timecode only when the shown text changes", async () => {
    const timecode = host.querySelector("button.font-mono > span");
    expect(timecode?.textContent).toBe("00:02");
    const writes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => writes.push(...records));
    observer.observe(timecode as Node, { childList: true, characterData: true, subtree: true });

    for (let frame = 1; frame <= 30; frame++) liveTime.notify(2 + frame / 120);
    await Promise.resolve();
    expect(writes).toHaveLength(0);

    liveTime.notify(3.01);
    await Promise.resolve();
    expect(timecode?.textContent).toBe("00:03");
    expect(writes.length).toBeGreaterThan(0);
    observer.disconnect();
  });
});
