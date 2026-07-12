// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
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
  expect(handled).toBe(true);
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
