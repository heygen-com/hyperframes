// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { useGsapAnimationsForElement } from "./useGsapTweenCache";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const fetchParsedAnimations = vi.hoisted(() => vi.fn());
vi.mock("./keyframeCacheAstLoad", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./keyframeCacheAstLoad")>()),
  fetchParsedAnimations,
}));

/** One result per render, so the assertions read a list instead of a mutated binding. */
const rendered: GsapAnimation[][] = [];

function Probe({ previewIframe }: { previewIframe: HTMLIFrameElement | null }) {
  const { animations } = useGsapAnimationsForElement(
    "p1",
    "index.html",
    { id: "dot-2", selector: "#dot-2" },
    0,
    previewIframe,
  );
  rendered.push(animations);
  return null;
}

function latest(): GsapAnimation[] {
  return rendered[rendered.length - 1] ?? [];
}

/**
 * A class tween — the `gsap.from(".dot", { stagger })` shape. It matches the
 * selected element only through the live DOM, so it is exactly what proves the
 * hook resolved the preview document it was handed.
 */
const CLASS_TWEEN = {
  id: "dot-from-0",
  targetSelector: ".dot",
  method: "from",
  position: 0,
  properties: {},
} as unknown as GsapAnimation;

let iframe: HTMLIFrameElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  rendered.length = 0;
  fetchParsedAnimations.mockResolvedValue({ animations: [CLASS_TWEEN] });
  iframe = document.createElement("iframe");
  document.body.append(iframe);
  iframe.contentDocument!.body.innerHTML = `<div id="dot-2" class="dot"></div>`;
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("useGsapAnimationsForElement", () => {
  it("attributes a class tween to the selected element through the preview document", async () => {
    await act(async () => {
      root.render(<Probe previewIframe={iframe} />);
    });

    expect(latest()).toEqual([CLASS_TWEEN]);
  });

  it("finds nothing without a preview document to match the class against", async () => {
    await act(async () => {
      root.render(<Probe previewIframe={null} />);
    });

    expect(latest()).toEqual([]);
  });

  it("re-resolves when the preview iframe is replaced", async () => {
    await act(async () => {
      root.render(<Probe previewIframe={null} />);
    });
    expect(latest()).toEqual([]);

    await act(async () => {
      root.render(<Probe previewIframe={iframe} />);
    });

    expect(latest()).toEqual([CLASS_TWEEN]);
  });
});
