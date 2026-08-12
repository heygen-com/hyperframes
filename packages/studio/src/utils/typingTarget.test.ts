// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { isTypingTarget } from "./typingTarget";
import { isEditableTarget } from "./timelineDiscovery";

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

describe("isTypingTarget", () => {
  it("keeps the legacy import on the same canonical decision", () => {
    expect(isEditableTarget).toBe(isTypingTarget);
  });

  // The bug this exists for: inline text editing uses plaintext-only, an
  // attribute selector for 'true' missed it, and the playback shortcuts ate
  // every letter typed into the composition.
  it("recognises a plaintext-only editable, not just contenteditable=true", () => {
    expect(isTypingTarget(mount('<h1 contenteditable="plaintext-only">Hi</h1>'))).toBe(true);
    expect(isTypingTarget(mount('<h1 contenteditable="true">Hi</h1>'))).toBe(true);
    expect(isTypingTarget(mount("<h1 contenteditable>Hi</h1>"))).toBe(true);
  });

  it("recognises a child of an editable, which a selector on the target alone misses", () => {
    const host = mount('<div contenteditable="true"><span>inner</span></div>');
    expect(isTypingTarget(host.querySelector("span"))).toBe(true);
  });

  it("recognises the ordinary fields too", () => {
    expect(isTypingTarget(mount("<input />"))).toBe(true);
    expect(isTypingTarget(mount("<textarea></textarea>"))).toBe(true);
    expect(isTypingTarget(mount("<select></select>"))).toBe(true);
    expect(isTypingTarget(mount('<div role="textbox"></div>'))).toBe(true);
    expect(isTypingTarget(mount('<div role="searchbox"></div>'))).toBe(true);
    expect(isTypingTarget(mount('<div role="combobox"></div>'))).toBe(true);
  });

  it("leaves the keys alone for anything that is not being typed into", () => {
    expect(isTypingTarget(mount("<div>plain</div>"))).toBe(false);
    expect(isTypingTarget(mount("<button>press</button>"))).toBe(false);
    expect(isTypingTarget(mount('<h1 contenteditable="false">Hi</h1>'))).toBe(false);
  });

  it("says no to nothing at all", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({} as EventTarget)).toBe(false);
  });
});
