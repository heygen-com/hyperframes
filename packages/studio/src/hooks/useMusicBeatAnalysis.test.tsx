// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileManagerProvider } from "../contexts/FileManagerContext";
import { usePlayerStore, type TimelineElement } from "../player/store/playerStore";
import { useMusicBeatAnalysis } from "./useMusicBeatAnalysis";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

function musicElement(): TimelineElement {
  return {
    id: "music-1",
    domId: "music-1",
    tag: "audio",
    src: "audio/track.mp3",
    timelineRole: "music",
    start: 0,
    duration: 30,
  } as unknown as TimelineElement;
}

/**
 * The hook reads its file IO out of this context. Only the two IO functions
 * matter here, so the rest of the file-manager surface is left off.
 */
function mountWithIo(io: {
  readOptionalProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  function Harness() {
    useMusicBeatAnalysis();
    return null;
  }

  const value = io as unknown as React.ComponentProps<typeof FileManagerProvider>["value"];
  act(() =>
    root.render(
      <FileManagerProvider value={value}>
        <Harness />
      </FileManagerProvider>,
    ),
  );
  return { unmount: () => act(() => root.unmount()) };
}

beforeEach(() => {
  usePlayerStore.setState({ elements: [musicElement()] });
});

afterEach(() => {
  usePlayerStore.setState({ elements: [] });
  document.body.innerHTML = "";
});

describe("useMusicBeatAnalysis", () => {
  it("reaches the project's file IO on the first commit", async () => {
    const readOptionalProjectFile = vi.fn(async () => "");
    const writeProjectFile = vi.fn(async () => {});

    // The IO is carried in a ref that used to be written during render. It is
    // written in an effect now, and that effect is declared before the loader,
    // so the loader still finds it on the very first commit. If it did not, the
    // hook would take the "no IO" branch and never read the beats file.
    const harness = mountWithIo({ readOptionalProjectFile, writeProjectFile });
    await act(async () => {
      await Promise.resolve();
    });

    expect(readOptionalProjectFile).toHaveBeenCalledWith(expect.stringContaining("track"));
    harness.unmount();
  });

  it("registers a beat writer that persists through the same IO", async () => {
    const readOptionalProjectFile = vi.fn(async () => "");
    const writeProjectFile = vi.fn(async () => {});
    const harness = mountWithIo({ readOptionalProjectFile, writeProjectFile });

    await act(async () => {
      await Promise.resolve();
    });

    expect(usePlayerStore.getState().beatPersist).toBeTypeOf("function");
    harness.unmount();
  });

  it("registers no beat writer when the project has no file IO", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    function Harness() {
      useMusicBeatAnalysis();
      return null;
    }
    act(() => root.render(React.createElement(Harness)));
    await act(async () => {
      await Promise.resolve();
    });

    expect(usePlayerStore.getState().beatPersist).toBeNull();
    act(() => root.unmount());
  });
});
