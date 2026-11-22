// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EDITING_ELEMENT_HANDLE, MAX_ELEMENT_TEXT } from "@hyperframes/core/runtime/editing-port";
import {
  findElementForSelection,
  findElementForTimelineElement,
  resolveDomEditSelection,
  type DomEditSelection,
} from "./domEditing";
import { setCompositionSourceMap } from "./domEditingDom";
import { dropElementCropLift, liftElementCrop, readElementCropInsets } from "./domEditOverlayCrop";
import { domEditSelectionToFacts } from "./domEditingLayers";
import {
  findPreviewElementForSelection,
  findPreviewElementForTimelineElement,
  resolvePreviewSelection,
  type PreviewSelectionOptions,
} from "./previewSelection";
import {
  describePreviewElements,
  previewElementsAtPoint,
  type PreviewElement,
} from "../../player/lib/previewElements";
import { detachedFakeIframe } from "../../player/hooks/timelinePlayerTestHarness";
import { installReactActEnvironment } from "../../hooks/domSelectionTestHarness";
import { useDomSelection } from "../../hooks/useDomSelection";
import type { TimelineElement } from "../../player";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";
import { resolveTimelineIdForSelection } from "../../utils/studioHelpers";
import { announceTimelineSelection } from "../../hooks/domSelectionTimelineMirror";

installReactActEnvironment();

const selectLog = vi.hoisted(() => ({ on: null as null | ((event: string) => void) }));
vi.mock("../../utils/selectDebug", () => ({
  logSelect: (event: string) => selectLog.on?.(event),
}));

const closers: Array<() => void> = [];
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  setCompositionSourceMap(new Map());
  document.body.innerHTML = "";
  delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
});

/** A frame Studio scripts directly; its document is this one. */
function liveFrame(): HTMLIFrameElement {
  const iframe = detachedFakeIframe({});
  Object.defineProperty(iframe, "contentDocument", { value: document });
  return iframe;
}

const CONTEXT: PreviewSelectionOptions = {
  activeCompositionPath: "index.html",
  isMasterView: false,
};

/** The selection both paths agree on: everything but the element itself and its text fields. */
function shared(selection: DomEditSelection | null) {
  if (!selection) return null;
  const { element: _element, handle: _handle, textFields: _fields, ...rest } = selection;
  // Read off the description only when `element` is a stand-in; checked on their own below.
  const { hasAudio: _audio, src: _src, ...compared } = rest;
  return compared;
}

/** The opaque frame's description of `element`, as a hit-test would hand it over. */
async function describedOnOpaque(iframe: HTMLIFrameElement, element: Element) {
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [element],
  });
  const [hit] = (await previewElementsAtPoint(iframe, 0, 0)) ?? [];
  const [described] = (await describePreviewElements(iframe, [hit!.handle])) ?? [];
  return described!;
}

async function bothPaths(element: HTMLElement, options: PreviewSelectionOptions = CONTEXT) {
  const opaque = sealedPreviewFrame().iframe;
  const live = await resolveDomEditSelection(element, options);
  const remote = await resolvePreviewSelection(
    opaque,
    await describedOnOpaque(opaque, element),
    options,
  );
  return { live, remote, opaque };
}

const NAMES = ["id", "data-hf-id", "data-pick", "data-composition-id"];
const nameOf = (element: Element) =>
  NAMES.map((name) => element.getAttribute(name)).find(Boolean) ?? null;
const named = (element: PreviewElement) =>
  NAMES.map((name) => element.attributes.find(([key]) => key === name)?.[1]).find(Boolean) ?? null;

const FIXTURE = `
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div data-hf-group="outer" id="outer-wrap">
      <div data-hf-group="inner"><p class="member" data-hf-id="m1" style="left: 4px; border-radius: 8px">Member</p></div>
    </div>
    <div class="clip scene" id="scene"><span class="inner"><b>bold</b></span></div>
    <div class="clip" data-composition-src="compositions/a.html" id="host"><span id="in-host">in</span></div>
    <div data-timeline-locked><p id="locked" data-start="2" style="border-radius: 8px">Locked</p></div>
    <i class="tile" id="t-index"></i>
    <div data-composition-file="compositions/cards.html"><i class="tile"></i><i class="tile" data-pick="t2"></i></div>
    <p id="plain"><b>no selector here</b></p>
  </div>
  <div id="bg" style="width: 1920px; height: 1080px"></div>`;

describe("opaque frame selections match same-origin ones", () => {
  it.each([
    ["a group member at the top level selects the outermost group", "[data-hf-id=m1]", {}],
    ["a clip's child, preferring the clip ancestor, selects the clip", "b", { clip: true }],
    ["a host clip is not taken for its child", "#in-host", { clip: true }],
    ["an element with no selector walks up to its addressable parent", "#plain b", {}],
    ["a timeline-locked element is selected as locked", "#locked", {}],
    ["a class match counts its index within its own file", "[data-pick=t2]", {}],
    ["a body child sitting on the root counts as the composition root", "#bg", {}],
  ])("%s", async (_name, selector, flags: { clip?: boolean }) => {
    document.body.innerHTML = FIXTURE;
    const { live, remote } = await bothPaths(document.querySelector<HTMLElement>(selector)!, {
      ...CONTEXT,
      preferClipAncestor: flags.clip,
    });
    expect(live).not.toBeNull();
    expect(shared(remote)).toEqual(shared(live));
    expect(remote!.handle).toMatch(EDITING_ELEMENT_HANDLE);
    expect(remote!.tagName).toBe(live!.element.tagName.toLowerCase());
  });

  it("covers the cases each rule decides", async () => {
    document.body.innerHTML = FIXTURE;
    const pick = async (selector: string, clip = false) =>
      (await bothPaths(document.querySelector<HTMLElement>(selector)!, {
        ...CONTEXT,
        preferClipAncestor: clip,
      }))!.remote!;
    expect((await pick("[data-hf-id=m1]")).selector).toBe("#outer-wrap");
    expect((await pick("b", true)).id).toBe("scene");
    expect((await pick("#in-host", true)).id).toBe("in-host");
    expect((await pick("#plain b")).id).toBe("plain");
    expect(await pick("#locked")).toMatchObject({
      isInsideLockedComposition: true,
      inlineStyles: { "border-radius": "8px" },
      dataAttributes: { start: "2" },
      label: "Locked",
    });
    expect(await pick("[data-pick=t2]")).toMatchObject({
      sourceFile: "compositions/cards.html",
      selectorIndex: 1,
    });
    expect((await pick("#bg")).capabilities).toMatchObject({
      canCrop: false,
      canApplyManualOffset: false,
    });
    expect((await pick("#plain")).capabilities.canApplyManualOffset).toBe(true);
  });

  it("follows a drilled-into group: its nested group, then its children, else the top level", async () => {
    document.body.innerHTML = FIXTURE;
    const member = document.querySelector<HTMLElement>("[data-hf-id=m1]")!;
    const opaque = sealedPreviewFrame().iframe;
    const described = await describedOnOpaque(opaque, member);
    const outerLive = document.querySelector<HTMLElement>('[data-hf-group="outer"]')!;
    const innerLive = document.querySelector<HTMLElement>('[data-hf-group="inner"]')!;
    // On an opaque frame the drilled-into group is the stand-in of an earlier selection.
    const outerRemote = (await resolvePreviewSelection(opaque, described, CONTEXT))!.element;
    const innerRemote = (await resolvePreviewSelection(opaque, described, {
      ...CONTEXT,
      activeGroupElement: outerRemote,
    }))!.element;
    const cases: Array<[HTMLElement | null, HTMLElement | null, string]> = [
      [outerLive, outerRemote, '[data-hf-group="inner"]'],
      [innerLive, innerRemote, ".member"],
      [document.querySelector<HTMLElement>("#scene"), null, "#outer-wrap"],
    ];
    for (const [activeLive, activeRemote, selector] of cases) {
      const live = await resolveDomEditSelection(member, {
        ...CONTEXT,
        activeGroupElement: activeLive,
      });
      const remote = await resolvePreviewSelection(opaque, described, {
        ...CONTEXT,
        activeGroupElement: activeRemote ?? document.createElement("div"),
      });
      expect(live!.selector).toBe(selector);
      expect(shared(remote)).toEqual(shared(live));
    }
  });

  it.each([
    [
      "by selector and index in its own file",
      { selector: ".tile", selectorIndex: 1, sourceFile: "compositions/cards.html" },
    ],
    ["by id", { id: "t-index", sourceFile: "index.html" }],
    ["by hf id", { hfId: "m1" }],
    ["nothing for a selector with no match", { selector: ".missing" }],
    ["nothing for an invalid selector", { selector: "p[" }],
  ])("finds an element for a selection %s", async (_name, selection) => {
    document.body.innerHTML = FIXTURE;
    const live = findElementForSelection(document, selection, "index.html");
    const found = await findPreviewElementForSelection(
      sealedPreviewFrame().iframe,
      selection,
      "index.html",
    );
    expect(live === null ? null : nameOf(live)).toBe(found === null ? null : found && named(found));
    if (selection.selector !== ".missing" && selection.selector !== "p[")
      expect(live).not.toBeNull();
  });

  it.each([
    [
      "a clip by selector",
      { id: "x", selector: ".tile", selectorIndex: 1, sourceFile: "compositions/cards.html" },
      false,
      "t2",
    ],
    ["the root, from the active composition, outside the master view", { id: "x" }, false, "main"],
    ["nothing in the master view without a DOM target", { id: "x" }, true, null],
  ])("finds a timeline element: %s", async (_name, element, isMasterView, expected) => {
    document.body.innerHTML = FIXTURE;
    const options = { activeCompositionPath: "index.html", isMasterView };
    const live = findElementForTimelineElement(document, element, options);
    const found = await findPreviewElementForTimelineElement(
      sealedPreviewFrame().iframe,
      element,
      options,
    );
    expect(live && nameOf(live)).toBe(expected);
    expect(found && named(found)).toBe(expected);
  });
});

describe("the timeline clip an opaque frame selection belongs to", () => {
  // fails without the fix: a sealed pick's stand-in has no parents, so a clip's child found no clip and copy, cut and
  // duplicate acted on the element instead of the clip a same-origin pick selects.
  it("is the clip a same-origin pick of the same child belongs to", async () => {
    document.body.innerHTML = `
      <div data-composition-id="main" data-width="1920" data-height="1080">
        <div class="clip" id="zone" data-start="0" data-duration="6"><div id="shape"></div></div>
      </div>`;
    const { live, remote } = await bothPaths(document.querySelector<HTMLElement>("#shape")!);
    const clips = [
      {
        id: "zone",
        domId: "zone",
        key: "index.html#zone",
        start: 0,
        duration: 6,
        track: 0,
        tag: "div",
      },
    ] as TimelineElement[];
    const announced = (selection: DomEditSelection) => {
      const setSelectedTimelineElementId = vi.fn();
      announceTimelineSelection(
        {
          timelineElements: clips,
          activeCompPath: "index.html",
          getTimelineSelectionSet: () => new Set(),
          setSelectedTimelineElementId,
          setTimelineSelectionSet: () => {},
        },
        [selection],
        selection,
      );
      return setSelectedTimelineElementId.mock.calls.at(-1)?.[0] ?? null;
    };

    expect(announced(live!)).toBe("index.html#zone");
    expect(announced(remote!)).toBe("index.html#zone");
    expect(resolveTimelineIdForSelection(remote!, clips, "index.html")).toBe("index.html#zone");
  });
});

describe("opaque frame selection handles", () => {
  it("gives a selection an inert, tag-only stand-in, the same one for a handle", async () => {
    document.body.innerHTML = FIXTURE;
    const { remote, opaque } = await bothPaths(document.querySelector<HTMLElement>("#locked")!);
    const again = await resolvePreviewSelection(
      opaque,
      await describedOnOpaque(opaque, document.querySelector("#locked")!),
      { ...CONTEXT, previous: remote },
    );
    expect(again!.element).toBe(remote!.element);
    expect(remote!.element.tagName).toBe("P");
    expect(remote!.element.attributes).toHaveLength(0);
    expect(remote!.element.textContent).toBe("");
    expect(remote!.element.ownerDocument.defaultView).toBeNull();
    expect(remote!.element.ownerDocument).not.toBe(document);
  });

  it("builds nothing for a removed element, and finds nothing the runtime cannot name", async () => {
    document.body.innerHTML = FIXTURE;
    const opaque = sealedPreviewFrame().iframe;
    const locked = document.querySelector("#locked")!;
    const described = await describedOnOpaque(opaque, locked);
    // A description whose parent is not the element its runtime names as the parent.
    const unlinked = { ...described, parent: described.handle };
    expect(await resolvePreviewSelection(opaque, unlinked, CONTEXT)).toBeNull();
    expect(await resolvePreviewSelection(opaque, described, CONTEXT)).not.toBeNull();
    locked.remove();
    expect(await resolvePreviewSelection(opaque, described, CONTEXT)).toBeNull();
    const stale = {
      ...described,
      handle: described.handle.replace(/^[0-9a-f]{16}/, "f".repeat(16)),
    };
    expect(await resolvePreviewSelection(opaque, stale, CONTEXT)).toBeNull();
  });

  it("says it cannot tell when the frame has no editing agent", async () => {
    vi.useFakeTimers();
    try {
      const frame: Record<string, unknown> = { postMessage: () => {} };
      const iframe = detachedFakeIframe(frame);
      const pending = findPreviewElementForSelection(iframe, { id: "plain" }, "index.html");
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await pending).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says it cannot tell when a capped query does not reach the index", async () => {
    document.body.innerHTML = "<i class='n'></i>".repeat(2_049);
    const found = await findPreviewElementForSelection(
      sealedPreviewFrame().iframe,
      { selector: ".n", selectorIndex: 2_048 },
      "index.html",
    );
    expect(found).toBeUndefined();
  });
});

describe("opaque frame selections read only what arrived whole", () => {
  it("reads audio and src off the description, not the tag-only stand-in", async () => {
    document.body.innerHTML = `<div data-composition-id="main" data-width="1920" data-height="1080">
      <video id="muted" muted src="a.mp4"></video><video id="silent" data-has-audio="false"></video>
      <video id="loud" src="b.mp4"></video><img id="pic" src="pic.png"></div>`;
    for (const [id, audible] of [
      ["muted", false],
      ["silent", false],
      ["loud", true],
    ] as const) {
      const { live, remote } = await bothPaths(document.getElementById(id)!);
      expect(domEditSelectionToFacts(live!).hasAudio).toBe(audible);
      expect(domEditSelectionToFacts(remote!).hasAudio).toBe(audible);
    }
    const { remote } = await bothPaths(document.getElementById("pic")!);
    expect(remote!.src).toBe("pic.png");
    expect(remote!.element.getAttribute("src")).toBeNull();
  });

  it("builds nothing when an attribute or inline style was cut, and is not stopped by long text", async () => {
    const chain = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: `node-${i}` })));
    document.body.innerHTML = `<div data-composition-id="main" data-width="1920" data-height="1080">
      <p id="fx" data-audio-fx='${chain}'>fx</p>
      <p id="bg-img" style="background-image: url(data:image/png;base64,${"A".repeat(3000)})">i</p>
      <p id="essay">${"y".repeat(MAX_ELEMENT_TEXT + 5)}</p></div>`;
    for (const id of ["fx", "bg-img"]) {
      const { live, remote } = await bothPaths(document.getElementById(id)!);
      expect(live).not.toBeNull();
      expect(remote).toBeNull();
    }
    const essay = await bothPaths(document.getElementById("essay")!);
    expect(essay.remote).toMatchObject({ id: "essay", selector: "#essay" });
  });

  it("selects an image with a short data: src, and not one whose data: src was cut", async () => {
    const icon = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`;
    document.body.innerHTML = `<div data-composition-id="main" data-width="1920" data-height="1080">
      <img id="icon"><img id="photo" src="data:image/png;base64,${"A".repeat(3000)}"></div>`;
    document.getElementById("icon")!.setAttribute("src", icon);
    const short = await bothPaths(document.getElementById("icon")!);
    expect(shared(short.remote)).toEqual(shared(short.live));
    expect(short.remote!.src).toBe(icon);
    const long = await bothPaths(document.getElementById("photo")!);
    expect(long.live).not.toBeNull();
    expect(long.remote).toBeNull();
  });

  it("builds nothing when the frame cannot read computed styles or the composition root", async () => {
    document.body.innerHTML = FIXTURE;
    const opaque = sealedPreviewFrame().iframe;
    const locked = await describedOnOpaque(opaque, document.querySelector("#locked")!);
    const bg = await describedOnOpaque(opaque, document.querySelector("#bg")!);
    expect(await resolvePreviewSelection(opaque, bg, CONTEXT)).not.toBeNull();

    const styles = vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
      throw new Error("parked");
    });
    expect(await resolvePreviewSelection(opaque, locked, CONTEXT)).toBeNull();
    styles.mockRestore();

    const query = document.querySelectorAll.bind(document);
    const roots = vi.spyOn(document, "querySelectorAll").mockImplementation((selector: string) => {
      if (selector === "[data-composition-id]") throw new Error("reloading");
      return query(selector);
    });
    expect(await resolvePreviewSelection(opaque, bg, CONTEXT)).toBeNull();
    roots.mockRestore();
  });
});

describe("useDomSelection on an opaque frame", () => {
  function renderSelection(iframe: HTMLIFrameElement) {
    let hook: ReturnType<typeof useDomSelection> | null = null;
    function Harness() {
      hook = useDomSelection({
        projectId: null,
        activeCompPath: "index.html",
        isMasterView: false,
        compIdToSrc: new Map(),
        captionEditMode: false,
        previewIframeRef: { current: iframe },
        timelineElements: [],
        getTimelineSelectionSet: () => new Set(),
        setSelectedTimelineElementId: vi.fn(),
        setTimelineSelectionSet: vi.fn(),
        setRightCollapsed: vi.fn(),
        setRightPanelTab: vi.fn(),
        previewIframe: iframe,
        refreshKey: 0,
        rightPanelTab: "design",
      });
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(React.createElement(Harness)));
    closers.push(() => act(() => root.unmount()));
    return () => hook!;
  }

  const clip = (selector: string) =>
    ({
      id: "c",
      selector,
      selectorIndex: 0,
      sourceFile: "index.html",
    }) as unknown as TimelineElement;

  it("selects a timeline clip, refreshes it, and drops it once the frame no longer has it", async () => {
    document.body.innerHTML = FIXTURE;
    const liveHook = renderSelection(liveFrame());
    const hook = renderSelection(sealedPreviewFrame().iframe);
    await act(() => liveHook().handleTimelineElementSelect(clip("#locked")));
    await act(() => hook().handleTimelineElementSelect(clip("#locked")));
    const selected = hook().domEditSelection!;
    expect(selected.handle).toMatch(EDITING_ELEMENT_HANDLE);
    expect(shared(selected)).toEqual(shared(liveHook().domEditSelection));

    document.querySelector<HTMLElement>("#locked")!.style.left = "12px";
    await act(() => hook().refreshDomEditSelectionFromPreview(selected));
    expect(hook().domEditSelection!.inlineStyles.left).toBe("12px");
    expect(hook().domEditSelection!.element).toBe(selected.element);

    document.querySelector("#locked")!.remove();
    await act(() => hook().refreshDomEditSelectionFromPreview(hook().domEditSelection!));
    expect(hook().domEditSelection).toBeNull();
  });

  it("re-finds every group member on refresh", async () => {
    document.body.innerHTML = FIXTURE;
    const hook = renderSelection(sealedPreviewFrame().iframe);
    await act(() => hook().handleTimelineElementSelect(clip("#locked")));
    const first = hook().domEditSelection!;
    await act(() => hook().handleTimelineElementSelect(clip("#plain")));
    const second = hook().domEditSelection!;
    act(() => hook().applyDomSelection(first, { additive: true }));
    expect(hook().domEditGroupSelections).toHaveLength(2);

    document.querySelector("#locked")!.remove();
    await act(() => hook().refreshDomEditSelectionFromPreview(first));
    expect(hook().domEditGroupSelections.map((s) => s.id)).toEqual(["plain"]);
    expect(hook().domEditSelection!.handle).toBe(second.handle);
  });

  it("leaves a group the user changed while its refresh was reading the frame", async () => {
    document.body.innerHTML = FIXTURE;
    const hook = renderSelection(sealedPreviewFrame().iframe);
    await act(() => hook().handleTimelineElementSelect(clip("#plain")));
    const plain = hook().domEditSelection!;
    await act(() => hook().handleTimelineElementSelect(clip("#locked")));
    const locked = hook().domEditSelection!;
    act(() => hook().applyDomSelection(plain, { additive: true }));
    await act(() => hook().handleTimelineElementSelect(clip("#scene")));
    const scene = hook().domEditSelection!;
    act(() => hook().applyDomSelection(locked, { additive: true }));
    act(() => hook().applyDomSelection(plain, { additive: true }));

    // The primary is gone, so the refresh re-reads the group; meanwhile the user picks one clip.
    document.querySelector("#plain")!.remove();
    selectLog.on = (event) => {
      if (event === "refresh-lost") hook().applyDomSelection(scene, { revealPanel: false });
    };
    try {
      await act(() => hook().refreshDomEditSelectionFromPreview(hook().domEditSelection!));
    } finally {
      selectLog.on = null;
    }
    expect(hook().domEditSelection!.id).toBe("scene");
    expect(hook().domEditGroupSelections.map((s) => s.id)).toEqual(["scene"]);
  });
});

describe("an opaque frame selection's crop", () => {
  it("reads the clip-path the frame renders, as a scriptable frame's does", async () => {
    document.body.innerHTML = FIXTURE;
    const plain = document.querySelector<HTMLElement>("#plain")!;
    plain.style.clipPath = "inset(10px 20px 30px 40px)";
    const { live, remote } = await bothPaths(plain);

    expect(readElementCropInsets(remote!.element)).toEqual(readElementCropInsets(live!.element));
    expect(readElementCropInsets(remote!.element)).toMatchObject({
      top: 10,
      right: 20,
      bottom: 30,
      left: 40,
    });
  });

  it("shows the element uncropped in the frame while selected, and crops it again after", async () => {
    document.body.innerHTML = FIXTURE;
    const plain = document.querySelector<HTMLElement>("#plain")!;
    plain.style.clipPath = "inset(10px 20px 30px 40px)";
    const { remote } = await bothPaths(plain);
    const shown = () => window.getComputedStyle(plain).clipPath;

    liftElementCrop(remote!.element);
    await vi.waitFor(() => expect(shown()).toBe("none"));
    expect(readElementCropInsets(remote!.element)).toMatchObject({ top: 10, left: 40 });
    dropElementCropLift(remote!.element);
    await vi.waitFor(() => expect(shown()).toBe("inset(10px 20px 30px 40px)"));
  });
});
