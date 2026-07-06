// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockParam } from "@hyperframes/core/registry";
import { FileManagerProvider } from "../../contexts/FileManagerContext";
import type { useFileManager } from "../../hooks/useFileManager";
import { StudioPlaybackProvider, type StudioPlaybackValue } from "../../contexts/StudioContext";
import { BlockParamsPanel } from "./BlockParamsPanel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.useFakeTimers();

const PARAMS: BlockParam[] = [
  { key: "--bg-color", label: "Background", type: "color", default: "#0c0c0c" },
  { key: "--text-color", label: "Text color", type: "color", default: "#fafafa" },
];

const playbackValue: StudioPlaybackValue = {
  captionEditMode: false,
  compositionLoading: false,
  refreshKey: 0,
  setRefreshKey: vi.fn(),
  timelineElements: [],
  isPlaying: false,
  refreshPreviewDocumentVersion: vi.fn(),
};

function makeFileManager(content: { value: string }) {
  const readProjectFile = vi.fn(async () => content.value);
  const writeProjectFile = vi.fn(async (_path: string, next: string) => {
    content.value = next;
  });
  // The panel only touches read/writeProjectFile; the rest of the context
  // surface is irrelevant to these tests.
  const value = { readProjectFile, writeProjectFile } as unknown as ReturnType<
    typeof useFileManager
  >;
  return { value, readProjectFile, writeProjectFile };
}

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllTimers();
});

function renderPanel(fileManager: ReturnType<typeof makeFileManager>["value"]) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <StudioPlaybackProvider value={playbackValue}>
        <FileManagerProvider value={fileManager}>
          <BlockParamsPanel
            blockName="vfx-demo"
            blockTitle="VFX Demo"
            params={PARAMS}
            compositionPath="compositions/vfx-demo.html"
            onClose={vi.fn()}
          />
        </FileManagerProvider>
      </StudioPlaybackProvider>,
    );
  });
}

function changeParam(label: string, next: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label} value"]`);
  if (!input) throw new Error(`no input for ${label}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function flushCommit() {
  await act(async () => {
    vi.advanceTimersByTime(350);
    // Drain the read → guard → write promise chain.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("BlockParamsPanel commit safety", () => {
  it("replaces duplicate occurrences of the param value with token boundaries", async () => {
    // The default legitimately appears twice (two CSS rules) — both belong to
    // the param, and the 8-digit hex must NOT be corrupted by substring match.
    const content = {
      value: ".a { background: #0c0c0c; } .b { border-color: #0c0c0c; } .c { color: #0c0c0cff; }",
    };
    const fm = makeFileManager(content);
    renderPanel(fm.value);

    changeParam("Background", "#123456");
    await flushCommit();

    expect(fm.writeProjectFile).toHaveBeenCalledTimes(1);
    expect(content.value).toBe(
      ".a { background: #123456; } .b { border-color: #123456; } .c { color: #0c0c0cff; }",
    );
  });

  it("refuses to write when the current value collides with unrelated content", async () => {
    const content = {
      value: ".a { background: #0c0c0c; } .b { color: #fafafa; }",
    };
    const fm = makeFileManager(content);
    renderPanel(fm.value);

    // First commit establishes the expected occurrence count (1).
    changeParam("Background", "#fafafa");
    await flushCommit();
    expect(content.value).toBe(".a { background: #fafafa; } .b { color: #fafafa; }");

    // Now "#fafafa" appears 2× (one ours, one unrelated) — a blind replace
    // would rewrite the unrelated one, so the panel must refuse.
    changeParam("Background", "#ff0000");
    await flushCommit();

    expect(fm.writeProjectFile).toHaveBeenCalledTimes(1); // no second write
    expect(content.value).toBe(".a { background: #fafafa; } .b { color: #fafafa; }");
    expect(document.body.textContent).toContain("could change unrelated content");
  });

  it("keeps a pending commit for one param when another param is edited", async () => {
    const content = {
      value: ".a { background: #0c0c0c; } .b { color: #fafafa; }",
    };
    const fm = makeFileManager(content);
    renderPanel(fm.value);

    // Edit both params back-to-back within the 300ms debounce window: the
    // second edit must not cancel the first param's pending commit.
    changeParam("Background", "#111111");
    changeParam("Text color", "#222222");
    await flushCommit();
    await flushCommit();

    expect(content.value).toContain("#111111");
    expect(content.value).toContain("#222222");
  });
});
