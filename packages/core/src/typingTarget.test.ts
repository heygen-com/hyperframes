import { afterEach, expect, it } from "vitest";
import { isTypingTarget } from "./typingTarget";

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
