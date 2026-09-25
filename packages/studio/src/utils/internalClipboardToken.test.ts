// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createInternalClipboardTokenStore,
  INTERNAL_CLIPBOARD_ROUTE,
  isInternalClipboardText,
} from "./internalClipboardToken";

const TOKEN = "a".repeat(43);
const PAYLOAD = {
  kind: "dom-element" as const,
  html: "<p>captured</p>",
  sourceFile: "index.html",
};

describe("internal clipboard token store", () => {
  it("resolves only the exact token in its source project", () => {
    const store = createInternalClipboardTokenStore({ token: () => TOKEN, now: () => 100 });
    const text = store.issue(PAYLOAD, "project-a");

    expect(text).toBe(`${INTERNAL_CLIPBOARD_ROUTE}\n${TOKEN}`);
    expect(store.resolve(text, "project-a")).toEqual({ kind: "resolved", payload: PAYLOAD });
    expect(store.resolve(text, "project-b")).toEqual({ kind: "foreign-project" });
  });

  it("distinguishes unrelated text from malformed and unknown reserved tokens", () => {
    const store = createInternalClipboardTokenStore({ token: () => TOKEN });

    expect(store.resolve("ordinary text", "project-a")).toEqual({ kind: "unrecognized" });
    expect(store.resolve(`${INTERNAL_CLIPBOARD_ROUTE}\nshort`, "project-a")).toEqual({
      kind: "unknown-token",
    });
    expect(store.resolve(`${INTERNAL_CLIPBOARD_ROUTE}\n${"b".repeat(43)}`, "project-a")).toEqual({
      kind: "unknown-token",
    });
  });

  it("expires without falling back to another entry", () => {
    let time = 10;
    const store = createInternalClipboardTokenStore({
      token: () => TOKEN,
      now: () => time,
      lifetimeMs: 50,
    });
    const text = store.issue(PAYLOAD, "project-a");
    time = 60;

    expect(store.resolve(text, "project-a")).toEqual({ kind: "expired-token" });
    expect(store.resolve(text, "project-a")).toEqual({ kind: "unknown-token" });
  });

  it("recognizes the reserved route before asynchronous work", () => {
    expect(isInternalClipboardText(`${INTERNAL_CLIPBOARD_ROUTE}\n${TOKEN}`)).toBe(true);
    expect(isInternalClipboardText("ordinary text")).toBe(false);
  });

  it("rejects a weak token source", () => {
    const store = createInternalClipboardTokenStore({ token: () => "predictable" });
    expect(() => store.issue(PAYLOAD, "project-a")).toThrow("invalid token");
  });
});
