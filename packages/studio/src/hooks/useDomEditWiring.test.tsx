// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";

const mocks = vi.hoisted(() => ({
  gsapUpdateProperty: vi.fn(),
  useGsapAnimationsForElement: vi.fn(),
  useAnimeAnimationsForElement: vi.fn(),
}));

vi.mock("./useDomEditPreviewSync", () => ({
  useDomEditPreviewSync: vi.fn(),
}));

vi.mock("./useGsapTweenCache", () => ({
  usePopulateKeyframeCacheForFile: vi.fn(),
  useGsapAnimationsForElement: (...args: unknown[]) => mocks.useGsapAnimationsForElement(...args),
}));

vi.mock("./useAnimeTweenCache", () => ({
  useAnimeAnimationsForElement: (...args: unknown[]) => mocks.useAnimeAnimationsForElement(...args),
}));

vi.mock("./useGsapAnimationFetchFallback", () => ({
  useGsapAnimationFetchFallback: () => () => Promise.resolve([]),
}));

vi.mock("./useGsapInteractionFailureTelemetry", () => ({
  useGsapInteractionFailureTelemetry: () => vi.fn(),
}));

vi.mock("./useGsapSelectionHandlers", () => ({
  useGsapSelectionHandlers: () => ({
    // fallow-ignore-next-line code-duplication
    handleGsapUpdateProperty: mocks.gsapUpdateProperty,
    handleGsapUpdateMeta: vi.fn(),
    handleGsapDeleteAnimation: vi.fn(),
    handleGsapDeleteAllForElement: vi.fn(),
    handleGsapAddAnimation: vi.fn(),
    handleGsapAddProperty: vi.fn(),
    handleGsapRemoveProperty: vi.fn(),
    handleGsapUpdateFromProperty: vi.fn(),
    handleGsapAddFromProperty: vi.fn(),
    handleGsapRemoveFromProperty: vi.fn(),
    handleGsapAddKeyframe: vi.fn(),
    handleGsapAddKeyframeBatch: vi.fn(),
    handleGsapRemoveKeyframe: vi.fn(),
    handleGsapMoveKeyframeToPlayhead: vi.fn(),
    handleGsapMoveKeyframe: vi.fn(),
    handleGsapResizeKeyframedTween: vi.fn(),
    handleGsapConvertToKeyframes: vi.fn(),
    handleGsapRemoveAllKeyframes: vi.fn(),
    handleResetSelectedElementKeyframes: vi.fn(),
  }),
}));

import { useDomEditWiring, type UseDomEditWiringParams } from "./useDomEditWiring";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const animeAnimation = {
  id: "anime-1",
  targetSelector: "#box",
  method: "to",
  position: 0,
  duration: 1,
  properties: { translateX: 0 },
  propertyGroup: "position",
  engine: "animejs",
  anime: { engine: "animejs" },
} as GsapAnimation;

const gsapAnimation = {
  id: "gsap-1",
  targetSelector: "#box",
  method: "to",
  position: 0,
  duration: 1,
  properties: { x: 10 },
  propertyGroup: "position",
} as GsapAnimation;

function selectionFor(element: HTMLElement): DomEditSelection {
  return {
    id: "box",
    selector: "#box",
    sourceFile: "index.html",
    element,
  } as DomEditSelection;
}

function baseWiringParams(selection: DomEditSelection): UseDomEditWiringParams {
  return {
    projectId: "proj-1",
    activeCompPath: "index.html",
    domEditSelection: selection,
    domEditSelectionRef: { current: selection },
    previewIframeRef: { current: null },
    previewIframe: null,
    captionEditMode: false,
    refreshKey: 0,
    gsapCacheVersion: 0,
    bumpGsapCache: vi.fn(),
    animeCacheVersion: 0,
    bumpAnimeCache: vi.fn(),
    showToast: vi.fn(),
    refreshPreviewDocumentVersion: vi.fn(),
    syncPreviewHistoryHotkey: vi.fn(),
    applyStudioManualEditsToPreviewRef: { current: async () => {} },
    applyDomSelection: vi.fn(),
    buildDomSelectionFromTarget: vi.fn(async () => null),
    updateGsapProperty: vi.fn(),
    updateGsapMeta: vi.fn(),
    deleteGsapAnimation: vi.fn(),
    deleteAllForSelector: vi.fn(),
    addGsapAnimation: vi.fn(async () => {}),
    addGsapProperty: vi.fn(),
    removeGsapProperty: vi.fn(),
    updateGsapFromProperty: vi.fn(),
    addGsapFromProperty: vi.fn(),
    removeGsapFromProperty: vi.fn(),
    addKeyframe: vi.fn(),
    addKeyframeBatch: vi.fn(async () => {}),
    removeKeyframe: vi.fn(),
    moveKeyframe: vi.fn(),
    resizeKeyframedTween: vi.fn(),
    convertToKeyframes: vi.fn(async () => {}),
    removeAllKeyframes: vi.fn(),
    updateAnimeProperty: vi.fn(async () => {}),
    updateAnimeMeta: vi.fn(async () => {}),
    deleteAnimeAnimation: vi.fn(async () => {}),
    addAnimeAnimation: vi.fn(async () => {}),
    addAnimeProperty: vi.fn(async () => {}),
    removeAnimeProperty: vi.fn(),
    updateAnimePropertyKeyframe: vi.fn(async () => {}),
    handleDomManualEditsReset: vi.fn(),
  };
}

function renderWiring(overrides: Partial<UseDomEditWiringParams> = {}) {
  const element = document.createElement("div");
  element.id = "box";
  const selection = selectionFor(element);
  const api: { current: ReturnType<typeof useDomEditWiring> | null } = { current: null };

  function Probe() {
    api.current = useDomEditWiring({ ...baseWiringParams(selection), ...overrides });
    return null;
  }

  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Probe />));
  return { api, root, selection };
}

describe("useDomEditWiring anime edit path", () => {
  it("routes anime-owned property edits to anime commit ops directly", () => {
    mocks.gsapUpdateProperty.mockReset();
    mocks.useGsapAnimationsForElement.mockReturnValue({
      animations: [],
      multipleTimelines: false,
      unsupportedTimelinePattern: false,
    });
    mocks.useAnimeAnimationsForElement.mockReturnValue({
      animations: [animeAnimation],
      rawAnimations: [],
      multipleTimelines: false,
      unsupportedTimelinePattern: false,
    });
    const updateAnimeProperty = vi.fn(async () => {});
    const { api, root, selection } = renderWiring({ updateAnimeProperty });

    act(() => api.current?.handleGsapUpdateProperty("anime-1", "translateX", 24));

    expect(updateAnimeProperty).toHaveBeenCalledWith(selection, "anime-1", "translateX", 24);
    expect(mocks.gsapUpdateProperty).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("marks same-element same-property GSAP/anime collisions read-only", () => {
    mocks.gsapUpdateProperty.mockReset();
    mocks.useGsapAnimationsForElement.mockReturnValue({
      animations: [gsapAnimation],
      multipleTimelines: false,
      unsupportedTimelinePattern: false,
    });
    mocks.useAnimeAnimationsForElement.mockReturnValue({
      animations: [animeAnimation],
      rawAnimations: [],
      multipleTimelines: false,
      unsupportedTimelinePattern: false,
    });
    const { api, root } = renderWiring();

    expect(api.current?.gsapUnsupportedTimelinePattern).toBe(true);
    act(() => root.unmount());
  });
});
