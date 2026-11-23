// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { EDITING_REQUEST_TIMEOUT_MS } from "@hyperframes/core/runtime/editing-port";
import { findPreviewElementForSelection, resolvePreviewSelection } from "./previewSelection";
import type { DomEditSelection } from "./domEditing";
import { useInlineTextEditing } from "./useInlineTextEditing";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";
import { retirePreviewEditingClient } from "../../player/lib/previewChannel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  previewIframeRef: { current: null as HTMLIFrameElement | null },
  handleDomRichTextCommit: vi.fn(),
  handleDomTextEditLost: vi.fn(),
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

async function sealedCanvas(
  selectedId: string,
  wrapHandedOverPort?: (port: MessagePort) => MessagePort,
) {
  document.body.innerHTML = `<h1 id="title">Hello</h1><p id="other">x</p>`;
  const { iframe } = sealedPreviewFrame({ wrapHandedOverPort });
  cleanups.push(() => retirePreviewEditingClient(iframe));
  actions.previewIframeRef.current = iframe;
  const select = async (id: string) => {
    const found = await findPreviewElementForSelection(iframe, { id, sourceFile: PATH }, PATH);
    return resolvePreviewSelection(iframe, found!, {
      activeCompositionPath: PATH,
      isMasterView: false,
      skipSourceProbe: true,
    });
  };
  const selectionRef = { current: (await select(selectedId)) as DomEditSelection | null };
  let canvas!: ReturnType<typeof useInlineTextEditing>;
  const root = createRoot(document.createElement("div"));
  act(() =>
    root.render(createElement(() => ((canvas = useInlineTextEditing(selectionRef)), null))),
  );
  cleanups.push(() => act(() => root.unmount()));
  return { canvas: () => canvas, select, selectionRef };
}

const press = { clientX: 40, clientY: 20 };
/** A press on the selection's box, which hands the canvas its own event. */
const onBox = () => {
  const box = document.createElement("div");
  box.setAttribute("data-dom-edit-selection-box", "true");
  return { ...press, currentTarget: box };
};
const editable = (id: string) => document.getElementById(id)!.getAttribute("contenteditable");

it("opens a sealed heading's text edit on a double press, as on a live preview", async () => {
  const { canvas } = await sealedCanvas("title");
  act(() => void canvas().startFromPress(onBox()));
  act(() => void canvas().startFromPress(onBox()));
  await vi.waitFor(() => expect(editable("title")).toBe("true"));
});

it("opens a sealed heading's text edit on a double press whose first press selects it", async () => {
  const { canvas, select, selectionRef } = await sealedCanvas("other");
  act(() => void canvas().startFromPress(press));
  selectionRef.current = await select("title");
  act(() => void canvas().startFromPress(onBox()));
  await vi.waitFor(() => expect(editable("title")).toBe("true"));
});

it("opens no edit on a double press that lands before the frame answers the first press's pick", async () => {
  const { canvas } = await sealedCanvas("other");
  act(() => void canvas().startFromPress(press));
  act(() => void canvas().startFromPress(press));
  expect(canvas().editing).toBe(false);
});

/** A frame that never receives a text edit's end, so Studio never hears how it ended. */
function droppingEnds(port: MessagePort) {
  const send = port.postMessage.bind(port);
  port.postMessage = (data: unknown) => {
    const message = data as { kind?: string; params?: { action?: string } };
    if (message.kind !== "text-edit" || message.params?.action !== "end") send(data);
  };
  return port;
}

it("reports through the edit session a sealed edit whose end the frame never answers", async () => {
  actions.handleDomTextEditLost.mockClear();
  const { canvas } = await sealedCanvas("title", droppingEnds);
  act(() => void canvas().startFromPress(onBox()));
  act(() => void canvas().startFromPress(onBox()));
  await vi.waitFor(() => expect(editable("title")).toBe("true"));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    act(() => void window.dispatchEvent(new FocusEvent("focus")));
    await vi.advanceTimersByTimeAsync(EDITING_REQUEST_TIMEOUT_MS);
  } finally {
    vi.useRealTimers();
  }
  await vi.waitFor(() => expect(actions.handleDomTextEditLost).toHaveBeenCalledOnce());
  expect(actions.handleDomTextEditLost).toHaveBeenCalledWith("the preview did not answer");
});

it("asks a sealed frame to put the caret where the second press landed, in the frame's own pixels", async () => {
  const starts: unknown[] = [];
  const { canvas } = await sealedCanvas("title", (port) => {
    const send = port.postMessage.bind(port);
    port.postMessage = (data: unknown) => {
      const message = data as { kind?: string; params?: { action?: string; caret?: unknown } };
      if (message.kind === "text-edit" && message.params?.action === "start")
        starts.push(message.params.caret);
      send(data);
    };
    return port;
  });
  const iframe = actions.previewIframeRef.current!;
  Object.defineProperty(iframe, "clientWidth", { value: 800 });
  iframe.getBoundingClientRect = () => ({ left: 10, top: 10, width: 400, height: 225 }) as DOMRect;
  act(() => void canvas().startFromPress(onBox()));
  act(() => void canvas().startFromPress(onBox()));
  await vi.waitFor(() => expect(starts).toEqual([{ x: 60, y: 20 }]));
});
