// @vitest-environment happy-dom
import { act } from "react";
import { expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { installReactActEnvironment, mountReactHarness } from "./domSelectionTestHarness";

installReactActEnvironment();

const dotTween = {
  id: "dots",
  targetSelector: ".dot",
  method: "from",
  position: 0,
  properties: { opacity: 0 },
} as GsapAnimation;
vi.mock("./keyframeCacheAstLoad", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./keyframeCacheAstLoad")>()),
  fetchParsedAnimations: async () => ({ animations: [dotTween] }),
}));
const { useGsapAnimationsForElement } = await import("./useGsapTweenCache");

it("attributes a class tween by the selected element, not an earlier same-id copy in a sub-composition", async () => {
  document.body.innerHTML =
    '<div data-composition-id="strip" data-composition-src="compositions/strip.html"><div id="card"></div></div>' +
    '<div id="card" class="dot"></div>';
  const element = document.querySelectorAll<HTMLElement>("#card")[1];
  const selection = { id: "card", sourceFile: "index.html", element } as DomEditSelection;
  const iframeRef = { current: { contentDocument: document } as unknown as HTMLIFrameElement };
  let animations: GsapAnimation[] = [];
  function Harness() {
    animations = useGsapAnimationsForElement("p", "index.html", selection, 0, iframeRef).animations;
    return null;
  }
  const root = mountReactHarness(<Harness />);
  await act(async () => {});
  expect(animations.map((animation) => animation.id)).toEqual(["dots"]);
  act(() => root.unmount());
});
