// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditing";
import { useDomEditPreviewSync } from "./useDomEditPreviewSync";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

function makeSelection(id: string): DomEditSelection {
  return {
    id,
    hfId: `hf-${id}`,
    selector: `#${id}`,
    selectorIndex: 0,
    sourceFile: "index.html",
    element: document.createElement("div"),
  } as unknown as DomEditSelection;
}

function Probe({
  domEditSelection,
  openSourceForSelection,
}: {
  domEditSelection: DomEditSelection | null;
  openSourceForSelection: (sourceFile: string, target: unknown) => void;
}) {
  useDomEditPreviewSync({
    previewIframe: null,
    activeCompPath: "index.html",
    captionEditMode: false,
    domEditSelectionRef: { current: null },
    domEditGroupSelectionsRef: { current: [] },
    domEditSelection,
    applyDomSelection: vi.fn(),
    refreshDomEditGroupSelectionsFromPreview: vi.fn(async () => {}),
    buildDomSelectionFromTarget: vi.fn(async () => null),
    refreshPreviewDocumentVersion: vi.fn(),
    syncPreviewHotkeys: vi.fn(),
    applyStudioManualEditsToPreviewRef: { current: vi.fn(async () => {}) },
    openSourceForSelection,
    getSidebarTab: () => "code",
  });
  return null;
}

let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  root = createRoot(document.createElement("div"));
});

afterEach(() => act(() => root.unmount()));

describe("useDomEditPreviewSync auto-reveal", () => {
  it("reveals the newly selected element's source while the Code tab is open", () => {
    const openSource = vi.fn();

    act(() => root.render(<Probe domEditSelection={null} openSourceForSelection={openSource} />));
    act(() =>
      root.render(
        <Probe domEditSelection={makeSelection("card")} openSourceForSelection={openSource} />,
      ),
    );

    expect(openSource).toHaveBeenCalledWith("index.html", {
      id: "card",
      selector: "#card",
      selectorIndex: 0,
    });
  });

  it("calls the newest reveal callback, not the one from the render that selected", () => {
    const stale = vi.fn();
    const fresh = vi.fn();
    const selection = makeSelection("card");

    act(() => root.render(<Probe domEditSelection={null} openSourceForSelection={stale} />));
    // The callback's identity changes on every edit to the open file, which is
    // why it is held in a ref at all. It still has to be the CURRENT one when
    // the next selection lands, not the one captured beside the ref.
    act(() => root.render(<Probe domEditSelection={null} openSourceForSelection={fresh} />));
    act(() => root.render(<Probe domEditSelection={selection} openSourceForSelection={fresh} />));

    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledTimes(1);
  });
});
