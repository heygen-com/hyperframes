import { afterEach, expect, it } from "vitest";
import { isTypingTarget, shouldIgnorePlaybackShortcutTarget } from "./typingTarget";

afterEach(() => document.body.replaceChildren());

it("treats a shadow host as typing while a field inside its shadow root has focus", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const field = host.attachShadow({ mode: "open" }).appendChild(document.createElement("input"));
  field.focus();

  expect(document.activeElement).toBe(host);
  expect(isTypingTarget(document.activeElement)).toBe(true);
});

it("does not treat a shadow host as typing when its focused element is not a field", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const frame = host.attachShadow({ mode: "open" }).appendChild(document.createElement("iframe"));
  frame.focus();

  expect(isTypingTarget(document.activeElement)).toBe(false);
});

function focusedInShadowOf(container: HTMLElement): HTMLElement {
  document.body.append(container);
  const host = container.appendChild(document.createElement("span"));
  const leaf = host.attachShadow({ mode: "open" }).appendChild(document.createElement("span"));
  leaf.tabIndex = 0;
  leaf.focus();
  return leaf;
}

it("treats focus inside a shadow root whose host sits in a modal dialog as typing", () => {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  focusedInShadowOf(dialog);

  expect(isTypingTarget(document.activeElement)).toBe(true);
});

it("leaves playback keys to a button that holds the focused shadow root's host", () => {
  focusedInShadowOf(document.createElement("button"));

  expect(shouldIgnorePlaybackShortcutTarget(document.activeElement)).toBe(true);
});
