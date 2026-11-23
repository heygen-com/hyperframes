// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findPreviewElementForSelection,
  resolvePreviewSelection,
} from "../components/editor/previewSelection";
import { drawPreviewDraft } from "../components/editor/previewDrafts";
import { sealedPreviewFrame } from "../player/lib/sealedPreviewFrame.test-helpers";
import { resizeSelectionFromAgent } from "../webmcp/StudioAgentTools";
import type { PersistDomEditOperations } from "./domEditCommitTypes";
import { useDomEditPositionPatchCommit } from "./useDomEditPositionPatchCommit";
import { useDomGeometryCommits } from "./useDomGeometryCommits";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PATH = "index.html";
const CARD = `<div id="card" style="position: absolute; left: 10px; top: 10px; width: 100px; height: 50px">Hi</div>`;

afterEach(() => {
  document.body.innerHTML = "";
});

/** Studio's geometry commits on a sealed preview of CARD, saving through `persist`. */
async function sealedCard(persist: PersistDomEditOperations) {
  document.body.innerHTML = CARD;
  const card = document.getElementById("card")!;
  const { iframe } = sealedPreviewFrame();
  const found = await findPreviewElementForSelection(
    iframe,
    { id: "card", sourceFile: PATH },
    PATH,
  );
  const selection = (await resolvePreviewSelection(iframe, found!, {
    activeCompositionPath: PATH,
    isMasterView: false,
    skipSourceProbe: true,
  }))!;
  let commits: ReturnType<typeof useDomGeometryCommits> | undefined;
  function Harness() {
    const commitPositionPatchToHtml = useDomEditPositionPatchCommit({
      activeCompPath: PATH,
      previewIframeRef: { current: iframe },
      persistDomEditOperations: persist,
      showToast: vi.fn(),
    });
    commits = useDomGeometryCommits({
      showToast: vi.fn(),
      readOnlyPreview: false,
      commitPositionPatchToHtml,
    });
    return null;
  }
  act(() => createRoot(document.createElement("div")).render(createElement(Harness)));
  return { card, selection, commits: commits! };
}

/** Lets the port's request and the frame's reply land. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const saved = () => vi.fn<PersistDomEditOperations>(async () => undefined);

describe("geometry commits in a sealed preview", () => {
  it("draws a resize from the agent on the frame's element", async () => {
    const { card, selection, commits } = await sealedCard(saved());

    await resizeSelectionFromAgent(
      selection,
      { width: 200, height: 80 },
      commits.handleDomBoxSizeCommit,
    );
    await settle();

    expect([card.style.width, card.style.height]).toEqual(["200px", "80px"]);
  });

  it("draws a size typed in the inspector on the frame's element", async () => {
    const persist = saved();
    const { card, selection, commits } = await sealedCard(persist);

    await commits.handleDomBoxSizeCommit(selection, { width: 160, height: 90 });
    await settle();

    expect([card.style.width, card.style.height]).toEqual(["160px", "90px"]);
    expect(persist.mock.calls[0]?.[2]).toMatchObject({ skipRefresh: true });
  });

  it("draws an offset typed in the inspector on the frame's element", async () => {
    const { card, selection, commits } = await sealedCard(saved());

    await commits.stageElementPositionOffset(selection, { x: 40, y: 20 }, true).save();
    await settle();

    expect(card.style.translate).toBe(selection.element.style.translate);
    expect(card.style.translate).toMatch(/40px/);
  });

  it("draws a rotation from the agent on the frame's element", async () => {
    const { card, selection, commits } = await sealedCard(saved());

    await commits.handleDomRotationCommit(selection, { angle: 30 });
    await settle();

    expect(card.style.rotate).toBe("30deg");
  });

  it("leaves the frame to a drag whose draft is still live", async () => {
    const { card, selection, commits } = await sealedCard(saved());
    drawPreviewDraft(selection.element, { size: { width: 150, height: 50 } });
    await settle();

    await commits.handleDomBoxSizeCommit(selection, { width: 200, height: 80 });
    await settle();

    expect(card.style.width).toBe("150px");
  });

  it("puts the frame's element and the selection back exactly when the save fails", async () => {
    const failed = vi.fn<PersistDomEditOperations>(async () => {
      throw new Error("disk full");
    });
    const { card, selection, commits } = await sealedCard(failed);
    const frameBefore = card.style.cssText;
    const shownBefore = selection.element.style.cssText;

    await expect(
      commits.handleDomBoxSizeCommit(selection, { width: 200, height: 80 }),
    ).rejects.toThrow("disk full");
    await settle();

    expect(card.style.cssText).toBe(frameBefore);
    expect(selection.element.style.cssText).toBe(shownBefore);
  });
});
