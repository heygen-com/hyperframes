// @vitest-environment happy-dom
/**
 * The playhead wears its own reserved token (R3, AE7).
 *
 * `theme.test.ts` already proves the three role colours differ from each other
 * in `theme.css`. What it cannot see is whether the playhead still ASKS for its
 * own: the accent was hard-coded here, so the timeline could have gone on
 * painting a green playhead over a green selection with the token file
 * perfectly correct. This is the consumer half of the same requirement.
 *
 * Asserted on the declaration rather than the resolved colour on purpose: happy-dom
 * has no stylesheet, so a computed style would read the variable back as an empty
 * string and pass whatever the code said. The rendered value is checked in the
 * browser, through the design-shots computed-style table.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { PlayheadIndicator } from "./PlayheadIndicator";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; host: HTMLElement } | null = null;

afterEach(() => {
  if (!mounted) return;
  const { root, host } = mounted;
  mounted = null;
  act(() => root.unmount());
  host.remove();
});

function render(scrubbing: boolean): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  act(() => root.render(<PlayheadIndicator scrubbing={scrubbing} />));
  return host;
}

it("paints the line and the head's outline from --color-playhead", () => {
  const host = render(false);
  const styles = [...host.querySelectorAll("[style]")].map(
    (element) => element.getAttribute("style") ?? "",
  );

  expect(styles.some((style) => style.includes("background: var(--color-playhead)"))).toBe(true);
  expect(styles.some((style) => style.includes("border-color: var(--color-playhead)"))).toBe(true);
  // The regression this file exists for: the playhead going back to the accent
  // and becoming indistinguishable from a selected clip.
  expect(styles.some((style) => /--color-accent|#3ce6ac|--hf-accent/i.test(style))).toBe(false);
});

it("fills the head from the same token while scrubbing", () => {
  const head = render(true).querySelector<HTMLElement>("[style*='rotate(45deg)']");

  expect(head?.style.background).toContain("var(--color-playhead)");
});
