// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../player";
import { useClipboard } from "./useClipboard";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const readFileContent = vi.hoisted(() => vi.fn(async () => "<body></body>"));
vi.mock("./timelineEditingHelpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./timelineEditingHelpers")>()),
  readFileContent,
}));

type Clipboard = ReturnType<typeof useClipboard>;

/** One handle per render, so the assertions read a list instead of a mutated binding. */
const rendered: Clipboard[] = [];
const showToast = vi.fn();

function Probe({ projectId }: { projectId: string | null }) {
  rendered.push(
    useClipboard({
      projectId,
      activeCompPath: "index.html",
      domEditSelectionRef: { current: null },
      showToast,
      writeProjectFile: vi.fn(async () => {}),
      recordEdit: vi.fn(async () => {}),
      domEditSaveTimestampRef: { current: 0 },
      reloadPreview: vi.fn(),
      handleTimelineElementDelete: vi.fn(async () => {}),
      handleDomEditElementDelete: vi.fn(async () => {}),
      previewIframeRef: { current: iframe },
    }),
  );
  return null;
}

function latest(): Clipboard {
  const handle = rendered[rendered.length - 1];
  if (!handle) throw new Error("hook did not render");
  return handle;
}

let iframe: HTMLIFrameElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  rendered.length = 0;
  vi.clearAllMocks();
  iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = `<div id="card" data-hf-id="hf-card" data-start="0">card</div>`;
  usePlayerStore.setState({
    selectedElementId: "card",
    elements: [
      {
        id: "card",
        domId: "card",
        hfId: "hf-card",
        selector: "#card",
        sourceFile: "index.html",
        start: 0,
        duration: 1,
      },
    ] as never,
  });
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  usePlayerStore.getState().reset();
});

describe("useClipboard", () => {
  it("pastes into the project the hook was last rendered with", async () => {
    act(() => root.render(<Probe projectId="first" />));
    expect(latest().handleCopy()).toBe(true);

    act(() => root.render(<Probe projectId="second" />));
    await act(async () => {
      await latest().handlePaste();
    });

    // The project id has to come from the current render, not from whatever it
    // was when the copy happened, or a paste after switching projects reads the
    // old project's file.
    expect(readFileContent).toHaveBeenCalledWith("second", "index.html");
  });

  it("does nothing when there is no project to paste into", async () => {
    act(() => root.render(<Probe projectId="first" />));
    latest().handleCopy();

    act(() => root.render(<Probe projectId={null} />));
    await act(async () => {
      await latest().handlePaste();
    });

    expect(readFileContent).not.toHaveBeenCalled();
  });
});
