// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { isImeComposing, outsideImeComposition } from "./imeComposition";

function keydown(init: KeyboardEventInit & { keyCode?: number }): KeyboardEvent {
  const event = new KeyboardEvent("keydown", init);
  if (init.keyCode !== undefined) Object.defineProperty(event, "keyCode", { value: init.keyCode });
  return event;
}

describe("isImeComposing", () => {
  it("is true for a key pressed while an IME is composing", () => {
    expect(isImeComposing(keydown({ key: "Enter", isComposing: true }))).toBe(true);
  });

  it("is true for Safari's composition-ending keydown, which only carries keyCode 229", () => {
    expect(isImeComposing(keydown({ key: "Enter", keyCode: 229 }))).toBe(true);
  });

  it("is false for a plain Enter", () => {
    expect(isImeComposing(keydown({ key: "Enter", keyCode: 13 }))).toBe(false);
  });

  it("reads the native event of a React keyboard event", () => {
    const nativeEvent = keydown({ key: "Escape", isComposing: true });
    expect(isImeComposing({ nativeEvent } as unknown as Parameters<typeof isImeComposing>[0])).toBe(
      true,
    );
  });

  it("keeps composing keys from a wrapped handler and passes the rest through", () => {
    const seen: string[] = [];
    const handler = outsideImeComposition((event: KeyboardEvent) => seen.push(event.key));
    handler(keydown({ key: "Enter", isComposing: true }));
    handler(keydown({ key: "Escape", keyCode: 229 }));
    handler(keydown({ key: "Enter", keyCode: 13 }));
    expect(seen).toEqual(["Enter"]);
  });
});
