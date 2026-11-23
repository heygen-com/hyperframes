// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { findPreviewElementForSelection, resolvePreviewSelection } from "./previewSelection";
import type { DomEditSelection } from "./domEditing";
import { useInlineTextEditing } from "./useInlineTextEditing";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";
import { retirePreviewEditingClient } from "../../player/lib/previewChannel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  previewIframeRef: { current: null as HTMLIFrameElement | null },
  handleDomRichTextCommit: vi.fn(),
}));
vi.mock("../../contexts/DomEditContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../contexts/DomEditContext")>()),
  useDomEditActionsContextOptional: () => actions,
}));

const PATH = "index.html";
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.innerHTML = "";
});

it("opens a sealed heading's text edit on a double press, as on a live preview", async () => {
  document.body.innerHTML = `<h1 id="title">Hello</h1><p id="other">x</p>`;
  const { iframe } = sealedPreviewFrame();
  cleanups.push(() => retirePreviewEditingClient(iframe));
  actions.previewIframeRef.current = iframe;
  const found = await findPreviewElementForSelection(
    iframe,
    { id: "title", sourceFile: PATH },
    PATH,
  );
  const selection = await resolvePreviewSelection(iframe, found!, {
    activeCompositionPath: PATH,
    isMasterView: false,
    skipSourceProbe: true,
  });
  const selectionRef = { current: selection as DomEditSelection | null };
  let canvas!: ReturnType<typeof useInlineTextEditing>;
  const root = createRoot(document.createElement("div"));
  act(() =>
    root.render(createElement(() => ((canvas = useInlineTextEditing(selectionRef)), null))),
  );
  cleanups.push(() => act(() => root.unmount()));

  const press = { clientX: 40, clientY: 20 };
  act(() => void canvas.startFromPress(press));
  act(() => void canvas.startFromPress(press));
  await vi.waitFor(() =>
    expect(document.getElementById("title")!.getAttribute("contenteditable")).toBe("true"),
  );
});
