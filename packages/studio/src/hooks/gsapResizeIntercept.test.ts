// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
import { computeCurrentPercentage } from "./gsapDragCommit";
import { tryGsapResizeIntercept } from "./gsapResizeIntercept";

afterEach(() => {
  vi.restoreAllMocks();
  usePlayerStore.setState({ currentTime: 0, activeKeyframePct: null });
});

/**
 * Scale-route resize: an element whose visual size is driven by a scale-group
 * tween. The intercept must (a) route the commit through SCALE, never
 * width/height, and (b) resolve convert-to-keyframes from-values through the
 * group filter — an opacity-touching intro tween on the same element must not
 * ride into the converted keyframes (the disappearance bake class).
 */
function makeGradedElement(): HTMLElement {
  const el = document.createElement("img");
  el.id = "clip";
  el.setAttribute("data-hf-studio-original-width", "640");
  el.setAttribute("data-hf-studio-original-height", "360");
  // Grading contract: source hidden, canvas carries effective opacity.
  el.setAttribute("data-hf-color-grading-source-hidden", "");
  const canvas = document.createElement("canvas");
  canvas.id = "__hf_color_grading_clip";
  canvas.style.opacity = "0.98";
  document.body.append(el, canvas);
  return el;
}

function fakeIframe(el: HTMLElement, gsapValues: Record<string, number>) {
  // The element's OPACITY intro tween lives on the timeline: unfiltered
  // capture would pick `opacity` up via the other-tween sweep.
  const opacityIntro = { targets: () => [el], vars: { opacity: 0, duration: 0.8 } };
  return {
    contentWindow: {
      __timelines: { main: { getChildren: () => [opacityIntro] } },
      gsap: { getProperty: (_el: Element, prop: string) => gsapValues[prop] ?? 0 },
    },
    contentDocument: document,
  } as unknown as HTMLIFrameElement;
}

function scaleFromTween(): GsapAnimation {
  return {
    id: "#clip-from-200-scale",
    targetSelector: "#clip",
    propertyGroup: "scale",
    method: "from",
    properties: { scale: 0.9 },
    position: 0.2,
    resolvedStart: 0.2,
    duration: 0.8,
  } as unknown as GsapAnimation;
}

function keyframedScaleFixture(): GsapAnimation {
  return {
    ...scaleFromTween(),
    keyframes: {
      keyframes: [
        { percentage: 0, properties: { scale: 0.9 } },
        { percentage: 100, properties: { scale: 1 } },
      ],
    },
  } as unknown as GsapAnimation;
}

// Resize/rotation hold tests intentionally pin the same no-conversion contract.
// fallow-ignore-next-line code-duplication
it("updates a duration-zero size hold in place instead of converting it to keyframes", async () => {
  const el = document.createElement("div");
  el.id = "box";
  document.body.append(el);
  const selection = { id: "box", selector: "#box", element: el } as DomEditSelection;
  const instantSizeHold = {
    id: "#box-to-0-size",
    targetSelector: "#box",
    propertyGroup: "size",
    method: "to",
    properties: { width: 150, height: 150 },
    position: 0,
    resolvedStart: 0,
    duration: 0,
    extras: { immediateRender: "__raw:true" },
  } as unknown as GsapAnimation;
  const commitMutation = vi.fn();

  const handled = await tryGsapResizeIntercept(
    selection,
    { width: 344, height: 344 },
    [instantSizeHold],
    null,
    commitMutation,
  );

  expect(handled).toMatchObject({ status: "persisted" });
  expect(commitMutation).toHaveBeenCalledTimes(1);
  expect(commitMutation.mock.calls[0]![1]).toEqual({
    type: "update-properties",
    animationId: "#box-to-0-size",
    properties: { width: 344, height: 344 },
  });
  expect(commitMutation).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ type: "convert-to-keyframes" }),
    expect.anything(),
  );
  expect(commitMutation).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ type: "add-keyframe" }),
    expect.anything(),
  );
});

// fallow-ignore-next-line code-duplication
it("requires explicit unroll for helper-authored resize before mutating", async () => {
  const el = document.createElement("div");
  el.id = "box";
  document.body.append(el);
  const selection = { id: "box", selector: "#box", element: el } as DomEditSelection;
  const helperSize = {
    id: "#box-to-size",
    targetSelector: "#box",
    propertyGroup: "size",
    method: "to",
    properties: { width: 150, height: 150 },
    duration: 1,
    provenance: { kind: "helper", fn: "grow", callSite: 1 },
  } as unknown as GsapAnimation;
  const commitMutation = vi.fn();

  await expect(
    tryGsapResizeIntercept(
      selection,
      { width: 344, height: 344 },
      [helperSize],
      null,
      commitMutation,
    ),
  ).resolves.toEqual({ status: "blocked", reason: "unroll-required" });
  expect(commitMutation).not.toHaveBeenCalled();
});

// fallow-ignore-next-line code-duplication
it("reuses the ownership parse instead of fetching a resolved size group twice", async () => {
  const el = document.createElement("div");
  el.id = "box";
  document.body.append(el);
  const selection = { id: "box", selector: "#box", element: el } as DomEditSelection;
  const sizeHold = {
    id: "#box-set-size",
    targetSelector: "#box",
    propertyGroup: "size",
    method: "set",
    properties: { width: 150, height: 150 },
  } as unknown as GsapAnimation;
  const fetchAnimations = vi.fn().mockResolvedValue([sizeHold]);
  const commitMutation = vi.fn();

  await expect(
    tryGsapResizeIntercept(
      selection,
      { width: 344, height: 344 },
      [],
      null,
      commitMutation,
      fetchAnimations,
    ),
  ).resolves.toEqual({ status: "persisted" });
  expect(fetchAnimations).toHaveBeenCalledTimes(1);
  expect(commitMutation).toHaveBeenCalledWith(
    selection,
    expect.objectContaining({ type: "update-properties", animationId: sizeHold.id }),
    expect.anything(),
  );
});

it("blocks when runtime size motion exists but the authored tween cannot be resolved", async () => {
  const el = document.createElement("div");
  el.id = "box";
  document.body.append(el);
  const selection = { id: "box", selector: "#box", element: el } as DomEditSelection;
  const liveSizeTween = {
    targets: () => [el],
    vars: { width: 300, duration: 1 },
    duration: () => 1,
    startTime: () => 0,
  };
  const iframe = {
    contentWindow: { __timelines: { main: { getChildren: () => [liveSizeTween] } } },
    contentDocument: document,
  } as unknown as HTMLIFrameElement;
  const commitMutation = vi.fn();

  await expect(
    tryGsapResizeIntercept(selection, { width: 344, height: 344 }, [], iframe, commitMutation),
  ).resolves.toEqual({ status: "blocked", reason: "source-uneditable" });
  expect(commitMutation).not.toHaveBeenCalled();
});

it("computes a finite zero percentage for a zero-duration tween", () => {
  const animation = {
    id: "#box-to-0-size",
    targetSelector: "#box",
    propertyGroup: "size",
    method: "to",
    properties: { width: 150 },
    resolvedStart: 1,
    duration: 0,
  } as unknown as GsapAnimation;
  const selection = {
    id: "box",
    selector: "#box",
    element: document.createElement("div"),
  } as DomEditSelection;
  usePlayerStore.setState({ currentTime: 5 });

  const percentage = computeCurrentPercentage(selection, animation);

  expect(Number.isFinite(percentage)).toBe(true);
  expect(percentage).toBe(0);
});

/** Drive one resize through the intercept, returning every committed mutation. */
async function runResize(
  el: HTMLElement,
  iframe: HTMLIFrameElement,
  size: { width: number; height: number },
): Promise<Array<Record<string, unknown>>> {
  const selection = { id: "clip", selector: "#clip", element: el } as unknown as DomEditSelection;
  usePlayerStore.setState({ currentTime: 0.5 }); // inside the tween's range
  const committed: Array<Record<string, unknown>> = [];
  const commitMutation = vi.fn(async (_sel: unknown, mutation: Record<string, unknown>) => {
    committed.push(mutation);
  });
  const handled = await tryGsapResizeIntercept(
    selection,
    size,
    [scaleFromTween()],
    iframe,
    commitMutation as never,
    async () => [keyframedScaleFixture()],
  );
  expect(handled).toMatchObject({ status: "persisted" });
  return committed;
}

it("scale-route resize converts via the group filter and commits scale, not width/height", async () => {
  const el = makeGradedElement();
  const iframe = fakeIframe(el, { scale: 1, scaleX: 1, scaleY: 1, opacity: 0, rotation: 0 });
  // uniform: 800/640 === 450/360
  const committed = await runResize(el, iframe, { width: 800, height: 450 });

  const convert = committed.find((m) => m.type === "convert-to-keyframes");
  expect(convert).toBeDefined();
  const fromValues = convert!.resolvedFromValues as Record<string, number>;
  // Group filter: the opacity intro tween must NOT leak into the conversion.
  expect(fromValues).not.toHaveProperty("opacity");
  expect(fromValues).toHaveProperty("scale");

  // Every committed property is scale-group — the resize never writes
  // width/height for a scale-driven element (the double-apply bug class).
  const allProps = committed.flatMap((m) => [
    ...Object.keys((m.properties as Record<string, unknown>) ?? {}),
    ...Object.keys((m.resolvedFromValues as Record<string, unknown>) ?? {}),
  ]);
  expect(allProps).not.toContain("width");
  expect(allProps).not.toContain("height");
  expect(allProps.some((p) => p === "scale" || p === "scaleX")).toBe(true);
});

it("non-uniform drag commits scaleX/scaleY longhands", async () => {
  const el = makeGradedElement();
  const iframe = fakeIframe(el, { scale: 1, scaleX: 1, scaleY: 1, opacity: 0 });
  // scaleX 1.25 vs scaleY 1.0 → non-uniform
  const committed = await runResize(el, iframe, { width: 800, height: 360 });

  const serialized = JSON.stringify(committed);
  expect(serialized).toContain("scaleX");
  expect(serialized).toContain("scaleY");
});

/**
 * The bug: the original box size was read only from the element's INLINE
 * width, and a composition sizes its elements from the stylesheet. With no
 * inline width the code fell back to a hardcoded 200, so the committed scale
 * came out `real / 200` times too large. Dropping a 630px chip at 2391px wide
 * left it rendering at 7532px, over three times where it was dropped, and the
 * next drag compounded it.
 */
// fallow-ignore-next-line code-duplication
it("scales from the element's real box, not a hardcoded fallback", async () => {
  const el = document.createElement("div");
  el.id = "clip";
  // Sized by a stylesheet, so it carries no inline width, and the draft
  // recorded the box it measured instead.
  el.setAttribute("data-hf-studio-original-box-width", "630");
  el.setAttribute("data-hf-studio-original-box-height", "252");
  document.body.append(el);
  const selection = { id: "clip", selector: "#clip", element: el } as DomEditSelection;
  const commitMutation = vi.fn();

  await tryGsapResizeIntercept(
    selection,
    { width: 1260, height: 504 },
    [keyframedScaleFixture()],
    fakeIframe(el, { scaleX: 1, scaleY: 1 }),
    commitMutation,
  );

  type Mutation = {
    properties?: Record<string, number>;
    keyframes?: Array<{ percentage: number; properties: Record<string, number> }>;
  };
  const committed = commitMutation.mock.calls
    .map((call) => call[1] as Mutation)
    .flatMap((mutation) => [
      mutation.properties,
      ...(mutation.keyframes ?? []).map((frame) => frame.properties),
    ])
    .filter((properties): properties is Record<string, number> => properties != null)
    .find((properties) => properties.scale != null || properties.scaleX != null);

  // Dropped at twice the element's own size, so the scale is about 2. The
  // number that matters is that it is not the 6.3 which 1260/200 produced.
  const scale = committed?.scale ?? committed?.scaleX ?? 0;
  expect(scale).toBeCloseTo(2, 1);
  expect(scale).toBeLessThan(3);
});

/**
 * The bug: a uniform drag committed the `scale` shorthand into a tween whose
 * keyframes already stated `scaleX`/`scaleY`. GSAP animates each property name
 * independently, so the keyframe ran as `{ scaleX: 1, scaleY: 1, scale: 0.61 }`
 * and the longhands won. The resize computed the right number, wrote it, and
 * the element snapped straight back to its old size on release.
 */
// fallow-ignore-next-line code-duplication
it("does not mix the scale shorthand into a tween that speaks longhands", async () => {
  const el = document.createElement("div");
  el.id = "clip";
  el.setAttribute("data-hf-studio-original-box-width", "630");
  el.setAttribute("data-hf-studio-original-box-height", "252");
  document.body.append(el);
  const selection = { id: "clip", selector: "#clip", element: el } as DomEditSelection;
  const longhandTween = {
    ...scaleFromTween(),
    keyframes: {
      keyframes: [
        { percentage: 0, properties: { scaleX: 1, scaleY: 1 } },
        { percentage: 100, properties: { scaleX: 1.15, scaleY: 1.15 } },
      ],
    },
  } as unknown as GsapAnimation;
  const commitMutation = vi.fn();

  // A uniform drop, so the old code took the shorthand branch and wrote
  // `scale` into keyframes that already stated the longhands.
  await tryGsapResizeIntercept(
    selection,
    { width: 384, height: 216 },
    [longhandTween],
    fakeIframe(el, { scaleX: 1, scaleY: 1 }),
    commitMutation,
  );

  const frames = commitMutation.mock.calls
    .map((call) => call[1] as { keyframes?: Array<{ properties: Record<string, number> }> })
    .flatMap((mutation) => mutation.keyframes ?? []);
  expect(frames.length).toBeGreaterThan(0);
  for (const frame of frames) {
    const names = Object.keys(frame.properties);
    const hasShorthand = names.includes("scale");
    const hasLonghand = names.includes("scaleX") || names.includes("scaleY");
    expect(hasShorthand && hasLonghand).toBe(false);
  }
  // And the resize still lands: 384/630 is about 0.61.
  const resized = frames.find((frame) => frame.properties.scaleX != null);
  expect(resized?.properties.scaleX).toBeCloseTo(0.61, 1);
});

/**
 * The bug: a scale resize measured its drop-point correction while the
 * gesture's own translation was still applied, but the position commit adds
 * that correction onto the element's PRE-gesture position (it reads the
 * gesture's base attributes). The two disagreed by the whole drag distance, so
 * every scale resize of a statically positioned element persisted a position a
 * drag-length away from where it was dropped — the element held still for one
 * frame and then slid off.
 *
 * The fixture models the geometry the browser reported: a 630x252 element
 * dragged from x=432 to x=587 with its box drafted down to 320x128, dropped at
 * a committed scale of 0.837. Scaling about the centre puts it back on the drop
 * point at its pre-gesture position, so the correct persisted correction is
 * NONE.
 */
it("does not move a statically positioned element when a scale resize lands", async () => {
  document.body.innerHTML = "";
  const el = document.createElement("div");
  el.id = "clip";
  el.setAttribute("data-hf-studio-original-box-width", "630");
  el.setAttribute("data-hf-studio-original-box-height", "252");
  // The gesture's base pose — where the commit puts the element back, since a
  // scale resize never persists the drag translation.
  el.setAttribute("data-hf-drag-gsap-base-x", "432");
  el.setAttribute("data-hf-drag-gsap-base-y", "173");
  // The draft the gesture left applied: a smaller box at the dragged position.
  el.setAttribute("data-hf-studio-box-size", "true");
  el.setAttribute("data-hf-studio-original-width", "");
  el.setAttribute("data-hf-studio-original-height", "");
  el.style.width = "320px";
  el.style.height = "128px";
  document.body.append(el);

  const pos = { x: 587, y: 235 };
  const scale = { x: 1.648, y: 1.648 };
  const [LEFT, TOP] = [120, 520];
  el.getBoundingClientRect = () => {
    const cssW = Number.parseFloat(el.style.width) || 630;
    const cssH = Number.parseFloat(el.style.height) || 252;
    const [w, h] = [cssW * scale.x, cssH * scale.y];
    // GSAP scales about the element centre, so the box grows around it.
    return {
      x: LEFT + pos.x + cssW / 2 - w / 2,
      y: TOP + pos.y + cssH / 2 - h / 2,
      width: w,
      height: h,
    } as DOMRect;
  };
  const gsapStub = {
    set: (_target: Element, vars: Record<string, number>) => {
      if (vars.x != null) pos.x = vars.x;
      if (vars.y != null) pos.y = vars.y;
      if (vars.scaleX != null) scale.x = vars.scaleX;
      if (vars.scaleY != null) scale.y = vars.scaleY;
    },
    getProperty: (_target: Element, prop: string) =>
      ({ scaleX: scale.x, scaleY: scale.y, x: pos.x, y: pos.y })[prop] ?? 0,
  };
  Object.assign(window, { gsap: gsapStub });
  const iframe = {
    contentWindow: { gsap: gsapStub, __timelines: {} },
    contentDocument: document,
  } as unknown as HTMLIFrameElement;
  const positionHold = {
    id: "#clip-set-0-position",
    targetSelector: "#clip",
    propertyGroup: "position",
    method: "set",
    properties: { x: 432, y: 173 },
    position: 0,
    resolvedStart: 0,
    duration: 0,
    global: true,
  } as unknown as GsapAnimation;
  const selection = { id: "clip", selector: "#clip", element: el } as DomEditSelection;
  usePlayerStore.setState({ currentTime: 0.5 });
  const commitMutation = vi.fn();

  await tryGsapResizeIntercept(
    selection,
    { width: 320, height: 128 },
    [keyframedScaleFixture(), positionHold],
    iframe,
    commitMutation,
    async () => [keyframedScaleFixture(), positionHold],
  );

  const positionWrites = commitMutation.mock.calls
    .map((call) => call[1] as { properties?: Record<string, number> })
    .filter((mutation) => mutation.properties?.x != null || mutation.properties?.y != null);
  // Either it left the position alone, or it rewrote the same value.
  for (const write of positionWrites) {
    expect(write.properties?.x).toBe(432);
    expect(write.properties?.y).toBe(173);
  }
  // And the live element ends on the drop point, not a drag away from it.
  expect(el.getBoundingClientRect().x).toBeCloseTo(603.3, 0);
});
