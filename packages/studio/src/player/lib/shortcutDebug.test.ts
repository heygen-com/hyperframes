// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeTarget, shortcutDebugEnabled, traceShortcut } from "./shortcutDebug";

interface DebugWindow {
  __hfDebugShortcuts?: boolean;
}

afterEach(() => {
  delete (window as unknown as DebugWindow).__hfDebugShortcuts;
  vi.restoreAllMocks();
});

describe("shortcutDebugEnabled", () => {
  it("is off unless asked for", () => {
    // The keyboard path runs on every keystroke, so silence is the only
    // acceptable default.
    expect(shortcutDebugEnabled()).toBe(false);
  });

  it("turns on from the console", () => {
    (window as unknown as DebugWindow).__hfDebugShortcuts = true;
    expect(shortcutDebugEnabled()).toBe(true);
  });
});

describe("traceShortcut", () => {
  it("writes nothing while disabled", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    traceShortcut("key seen", { code: "Space" });
    expect(info).not.toHaveBeenCalled();
  });

  it("prefixes every line so a user can filter and paste them back", () => {
    (window as unknown as DebugWindow).__hfDebugShortcuts = true;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    traceShortcut("key seen", { code: "Space" });

    expect(info).toHaveBeenCalledWith("[studio:shortcuts] key seen", { code: "Space" });
  });
});

describe("describeTarget", () => {
  it("names an element without dumping the node", () => {
    const el = document.createElement("canvas");
    el.id = "stage";
    el.className = "preview big";
    expect(describeTarget(el)).toBe("canvas#stage.preview");
  });

  it("survives a target that is not an element", () => {
    expect(describeTarget(null)).toBe("none");
    expect(describeTarget(new EventTarget())).toBe("non-element");
  });
});
