// @vitest-environment happy-dom
/**
 * The header after the primitive sweep: the controls really are the shared
 * ones, the disabled history buttons still say why they are disabled, and both
 * global hotkey filters classify the new elements the way they classified the
 * hand-rolled ones (KTD13).
 *
 * The contexts are mocked rather than provided: this file is about the markup
 * the header renders, and building three real provider values would test the
 * providers instead.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buttonSizes, buttonVariants } from "./ui";
import { isTypingTarget } from "../utils/typingTarget";
import { shouldIgnorePlaybackShortcutTarget } from "../player/lib/playbackShortcuts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const editHistory = {
  canUndo: false,
  canRedo: false,
  undoLabel: undefined as string | undefined,
  redoLabel: undefined as string | undefined,
};
const renderQueue = { isRendering: false, ffmpegMissing: false };

vi.mock("../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({
    projectId: "demo",
    editHistory,
    handleUndo: vi.fn(),
    handleRedo: vi.fn(),
    renderQueue,
  }),
}));

vi.mock("../contexts/PanelLayoutContext", () => ({
  usePanelLayoutContext: () => ({
    effectiveRightCollapsed: false,
    setRightCollapsed: vi.fn(),
    setRightPanelTab: vi.fn(),
  }),
}));

vi.mock("../contexts/ViewModeContext", () => ({
  useViewMode: () => ({ viewMode: "timeline", setViewMode: vi.fn(() => true) }),
}));

vi.mock("../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

const { StudioHeader } = await import("./StudioHeader");

let mounted: { root: Root; host: HTMLElement } | null = null;

beforeEach(() => {
  editHistory.canUndo = false;
  editHistory.canRedo = false;
  editHistory.undoLabel = undefined;
  editHistory.redoLabel = undefined;
  renderQueue.isRendering = false;
});

afterEach(() => {
  if (!mounted) return;
  const { root, host } = mounted;
  mounted = null;
  act(() => root.unmount());
  host.remove();
});

function mount(): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  act(() =>
    root.render(
      <StudioHeader
        captureFrameHref="blob:frame"
        captureFrameFilename="frame.png"
        handleCaptureFrameClick={vi.fn()}
        refreshCaptureFrameTime={vi.fn()}
        inspectorButtonActive={false}
        inspectorPanelActive={false}
      />,
    ),
  );
  return host;
}

function query(host: HTMLElement, selector: string): HTMLElement {
  const el = host.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`not rendered: ${selector}`);
  return el;
}

/** Every class the recipe asks for, on the element the header rendered. */
function expectRecipe(el: HTMLElement, ...recipes: string[]): void {
  const applied = new Set(el.className.split(/\s+/));
  for (const recipe of recipes) {
    for (const token of recipe.split(/\s+/)) {
      expect(applied, `${token} missing from: ${el.className}`).toContain(token);
    }
  }
}

it("renders Export as the shared primary Button at the medium size", () => {
  const host = mount();

  expectRecipe(
    query(host, '[data-testid="header-export"]'),
    buttonVariants.primary,
    buttonSizes.md,
  );
});

it("disables Undo and Redo while the history is empty", () => {
  const host = mount();

  expect(query(host, '[aria-label="Undo"]').hasAttribute("disabled")).toBe(true);
  expect(query(host, '[aria-label="Redo"]').hasAttribute("disabled")).toBe(true);
});

it("enables Undo once there is something to undo", () => {
  editHistory.canUndo = true;
  editHistory.undoLabel = "Move layer";
  const host = mount();

  expect(query(host, '[aria-label="Undo"]').hasAttribute("disabled")).toBe(false);
});

it("keeps Capture a real download link rather than a button", () => {
  // `download` is what saves the frame. A Button here would render a <button>
  // and the control would quietly stop downloading anything.
  const host = mount();
  const capture = query(host, '[aria-label="Capture current frame"]');

  expect(capture.tagName).toBe("A");
  expect(capture.getAttribute("download")).toBe("frame.png");
  expectRecipe(capture, buttonSizes.md);
});

it("gives the view-mode toggle a real tablist", () => {
  const host = mount();
  const list = query(host, '[aria-label="Studio view"]');

  expect(list.getAttribute("role")).toBe("tablist");
  expect(
    [...list.querySelectorAll("[data-tab-id]")].map((el) => el.getAttribute("data-tab-id")),
  ).toEqual(["storyboard", "timeline"]);
});

it("classifies the new header controls for the hotkey filters as the old ones were (KTD13)", () => {
  // Every one of these was a <button> or an <a href> before the sweep: never a
  // typing target, always claimed by the playback filter. A primitive that
  // rendered a different element would leak or swallow hotkeys in silence.
  const host = mount();
  const controls = [
    query(host, '[data-testid="header-export"]'),
    query(host, '[aria-label="Undo"]'),
    query(host, '[aria-label="Redo"]'),
    query(host, '[aria-label="Inspector"]'),
    query(host, '[aria-label="Capture current frame"]'),
    query(host, '[data-tab-id="timeline"]'),
  ];

  for (const el of controls) {
    expect(isTypingTarget(el), el.getAttribute("aria-label") ?? el.tagName).toBe(false);
    expect(shouldIgnorePlaybackShortcutTarget(el), el.tagName).toBe(true);
  }
});
