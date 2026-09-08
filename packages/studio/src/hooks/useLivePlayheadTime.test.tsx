// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveTime, usePlayerStore } from "../player/store/playerStore";
import { useLivePlayheadTime } from "./useLivePlayheadTime";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Past the hook's 33ms throttle. */
const PAST_THROTTLE_MS = 40;

function mountReadout() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let current = Number.NaN;

  function Readout() {
    current = useLivePlayheadTime();
    return null;
  }

  act(() => root.render(React.createElement(Readout)));
  return {
    read: () => current,
    unmount: () => act(() => root.unmount()),
  };
}

function setTransport(currentTime: number, isPlaying: boolean) {
  act(() => usePlayerStore.setState({ currentTime, isPlaying }));
}

beforeEach(() => {
  vi.useFakeTimers();
  usePlayerStore.setState({ currentTime: 0, isPlaying: false });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useLivePlayheadTime", () => {
  it("reports the store's time while paused, including after a seek", () => {
    const readout = mountReadout();
    expect(readout.read()).toBe(0);

    setTransport(4.25, false);
    expect(readout.read()).toBe(4.25);

    readout.unmount();
  });

  it("ignores live notifications while paused", () => {
    const readout = mountReadout();
    setTransport(2, false);

    act(() => {
      liveTime.notify(9);
      vi.advanceTimersByTime(PAST_THROTTLE_MS);
    });

    expect(readout.read()).toBe(2);
    readout.unmount();
  });

  it("follows live notifications while playing, throttled", () => {
    const readout = mountReadout();
    setTransport(1, true);

    act(() => liveTime.notify(1.1));
    // Inside the throttle window nothing has been published yet.
    expect(readout.read()).toBe(1);

    act(() => {
      liveTime.notify(1.4);
      vi.advanceTimersByTime(PAST_THROTTLE_MS);
    });
    // The flush publishes the newest value seen, not the one that armed it.
    expect(readout.read()).toBe(1.4);

    readout.unmount();
  });

  it("does not show the previous run's live time on the first frame of a new one", () => {
    const readout = mountReadout();
    setTransport(1, true);
    act(() => {
      liveTime.notify(7.5);
      vi.advanceTimersByTime(PAST_THROTTLE_MS);
    });
    expect(readout.read()).toBe(7.5);

    // Pause, seek back to the top, play again: the readout must start from the
    // store, not from where the last run stopped.
    setTransport(7.5, false);
    setTransport(0, false);
    setTransport(0, true);
    expect(readout.read()).toBe(0);

    readout.unmount();
  });
});
