// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findPreviewElementForSelection,
  resolvePreviewSelection,
} from "../components/editor/previewSelection";
import {
  drawPreviewDraft,
  previewDraftsSent,
  previewStandIn,
} from "../components/editor/previewDrafts";
import { captureStudioBoxSize, restoreStudioBoxSize } from "../components/editor/manualEdits";
import {
  STUDIO_ORIGINAL_BOX_HEIGHT_ATTR,
  STUDIO_ORIGINAL_BOX_WIDTH_ATTR,
} from "../components/editor/manualEditsTypes";
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
  const card = laidOut(document.getElementById("card")!);
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

/** happy-dom lays nothing out: the element's box follows its inline size, as a browser's would here. */
function laidOut(element: HTMLElement) {
  Object.defineProperties(element, {
    offsetWidth: { configurable: true, get: () => Number.parseFloat(element.style.width) || 0 },
    offsetHeight: { configurable: true, get: () => Number.parseFloat(element.style.height) || 0 },
  });
  return element;
}

const originalBox = (element: HTMLElement) => [
  element.getAttribute(STUDIO_ORIGINAL_BOX_WIDTH_ATTR),
  element.getAttribute(STUDIO_ORIGINAL_BOX_HEIGHT_ATTR),
];

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

// fails without the fix: a resize with no press read the stand-in's own box (0 x 0) or the last press's.
describe("a sealed resize with no press saves the box the frame lays out now", () => {
  it("from a size typed in the inspector", async () => {
    const { selection, commits } = await sealedCard(saved());

    await commits.handleDomBoxSizeCommit(selection, { width: 160, height: 90 });

    expect(originalBox(selection.element)).toEqual(["100", "50"]);
  });

  it("from the agent's resize", async () => {
    const { selection, commits } = await sealedCard(saved());

    await resizeSelectionFromAgent(
      selection,
      { width: 200, height: 80 },
      commits.handleDomBoxSizeCommit,
    );

    expect(originalBox(selection.element)).toEqual(["100", "50"]);
  });

  it("after a resize is undone, the same as an open element", async () => {
    const { card, selection, commits } = await sealedCard(saved());
    const open = laidOut(document.createElement("div"));
    open.style.cssText = card.style.cssText;
    document.body.append(open);
    const openSelection = { ...selection, element: open };
    const source = card.style.cssText;
    const sealedBefore = captureStudioBoxSize(selection.element);
    const openBefore = captureStudioBoxSize(open);

    for (const sel of [selection, openSelection])
      await commits.handleDomBoxSizeCommit(sel, { width: 160, height: 90 });
    await settle();
    card.style.cssText = source;
    restoreStudioBoxSize(selection.element, sealedBefore);
    restoreStudioBoxSize(open, openBefore);
    for (const sel of [selection, openSelection])
      await commits.handleDomBoxSizeCommit(sel, { width: 120, height: 70 });

    expect(originalBox(open)).toEqual(["100", "50"]);
    expect(originalBox(selection.element)).toEqual(originalBox(open));
  });
});

// fails without the fix: the agent's draft stayed on the stand-in, so a scale resize found its drop point at the old
// centre and saved no re-centring move.
it("draws the agent's resize on the frame before its commit measures it", async () => {
  const { card, selection } = await sealedCard(saved());
  let drawn = "";

  await resizeSelectionFromAgent(selection, { width: 200, height: 80 }, async () => {
    await previewDraftsSent(previewStandIn(selection.element)!.iframe);
    drawn = `${card.style.width} ${card.style.height}`;
  });

  expect(drawn).toBe("200px 80px");
});

it("hands the frame back once the agent's resize is saved", async () => {
  const { card, selection, commits } = await sealedCard(saved());
  await resizeSelectionFromAgent(
    selection,
    { width: 200, height: 80 },
    commits.handleDomBoxSizeCommit,
  );
  await settle();

  await commits.handleDomBoxSizeCommit(selection, { width: 160, height: 90 });
  await settle();

  expect([card.style.width, card.style.height]).toEqual(["160px", "90px"]);
});
