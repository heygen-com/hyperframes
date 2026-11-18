import { expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { createSealedPreviewSeekReapplyScript } from "@hyperframes/studio-server/manual-edits-render-script";
import { installStudioManualEditSeekReapply } from "./manualEdits";

type PreviewWindow = Parameters<typeof installStudioManualEditSeekReapply>[0] & {
  __player: { seek: (time: number) => void };
};

/** A preview frame with a sized card whose seeks clear its width; `parent` is what the frame can read of Studio. */
function previewFrame(parent: unknown) {
  const win = new Window();
  win.document.body.innerHTML = `<div id="card" data-hf-studio-box-size="true"
    style="--hf-studio-width: 200px; --hf-studio-height: 100px; width: 200px; height: 100px"></div>`;
  const card = win.document.getElementById("card") as unknown as HTMLElement;
  const frame = win as unknown as PreviewWindow;
  frame.__player = { seek: () => void card.style.removeProperty("width") };
  Object.defineProperty(win, "parent", { value: parent });
  Object.assign(win, { SyntaxError });
  new Function(
    "window",
    "document",
    "HTMLElement",
    "DOMMatrix",
    "setInterval",
    "clearInterval",
    createSealedPreviewSeekReapplyScript(),
  )(
    win,
    win.document,
    win.HTMLElement,
    globalThis.DOMMatrix,
    () => 0,
    () => undefined,
  );
  const widthWrites = vi.spyOn(card.style, "setProperty");
  const writes = () => widthWrites.mock.calls.filter(([name]) => name === "width").length;
  return { frame, card, writes };
}

it("reapplies once per seek in a frame Studio scripts: Studio's wrapper, never the frame's script too", () => {
  const { frame, card, writes } = previewFrame({ document: {} });
  let studioApplies = 0;
  installStudioManualEditSeekReapply(frame, () => {
    studioApplies += 1;
  });
  studioApplies = 0;

  frame.__player.seek(1);
  expect(studioApplies).toBe(1);
  expect(writes()).toBe(0);
  expect(card.style.getPropertyValue("width")).toBe("");
});

it("reapplies once per seek in a frame Studio cannot script, from the frame's own script", () => {
  const sealed = {
    get document(): never {
      throw new Error("SecurityError");
    },
  };
  const { frame, card, writes } = previewFrame(sealed);

  frame.__player.seek(1);
  expect(writes()).toBe(1);
  expect(card.style.getPropertyValue("width")).toBe("200px");
});
