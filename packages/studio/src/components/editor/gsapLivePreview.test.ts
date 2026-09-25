// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { createGsapLivePreview } from "./gsapLivePreview";
import type { DomEditSelection } from "./domEditingTypes";

it("previews on the selected element, not an earlier same-id copy in a sub-composition", () => {
  document.body.innerHTML =
    '<div data-composition-id="strip"><div id="card" data-hf-id="hf-inner"></div></div>' +
    '<div id="card" data-hf-id="hf-root"></div>';
  const set = vi.fn();
  const iframe = { contentWindow: { gsap: { set } }, contentDocument: document };
  const preview = createGsapLivePreview({ current: iframe as unknown as HTMLIFrameElement });
  preview({ id: "card", hfId: "hf-root" } as DomEditSelection, { x: 10 });
  expect(set.mock.calls[0]?.[0]).toBe(document.querySelector('[data-hf-id="hf-root"]'));
});

it("previews on the copy in the selection's own file when a sub-composition repeats its hf-id", () => {
  document.body.innerHTML =
    '<div data-composition-id="strip" data-composition-src="compositions/strip.html">' +
    '<div id="card" data-hf-id="hf-card"></div></div><div id="card" data-hf-id="hf-card" class="root"></div>';
  const set = vi.fn();
  const iframe = { contentWindow: { gsap: { set } }, contentDocument: document };
  const preview = createGsapLivePreview({ current: iframe as unknown as HTMLIFrameElement });
  preview({ id: "card", hfId: "hf-card", sourceFile: "index.html" } as DomEditSelection, { x: 10 });
  expect(set.mock.calls[0]?.[0]).toBe(document.querySelector(".root"));
});
