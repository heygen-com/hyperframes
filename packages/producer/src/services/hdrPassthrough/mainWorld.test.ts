import { describe, expect, it } from "bun:test";
import { CAPTURE_SOURCE, intrinsicChangeFinding } from "./mainWorld.js";
import type { PropertiesLike, ReadProperties, RemoteObjectLike } from "./nativeCallbacks.js";

const located = { name: "[[FunctionLocation]]", value: { type: "object" } };
const TABLE: Record<string, PropertiesLike> = {
  script: { result: [], internalProperties: [located] },
  native: { result: [], internalProperties: [] },
};
const readProperties: ReadProperties = async (objectId) => {
  const found = TABLE[objectId];
  if (!found) throw new Error(`no properties for ${objectId}`);
  return found;
};

const fn = (objectId: string, description: string): RemoteObjectLike => ({
  type: "function",
  objectId,
  description,
});

const change = (label: string, key: string, what: string, value: RemoteObjectLike) => ({
  label,
  key,
  what,
  value,
});

describe("intrinsicChangeFinding", () => {
  it("passes a builtin replaced by script: the page's, which the call counts see, or the renderer's", async () => {
    const polyfill = fn("script", "function at(i) { return this[i]; }");
    expect(
      await intrinsicChangeFinding(
        change("Array.prototype", "at", "value", polyfill),
        readProperties,
      ),
    ).toBeNull();
  });

  it("declines a builtin replaced by another builtin", async () => {
    const constant = fn("native", "function String() { [native code] }");
    expect(
      await intrinsicChangeFinding(change("JSON", "stringify", "value", constant), readProperties),
    ).toBe("JSON.stringify was replaced by native function String");
  });

  it("declines a getter that is a builtin, a removed builtin and a replaced prototype", async () => {
    const getter = fn("native", "function max() { [native code] }");
    expect(
      await intrinsicChangeFinding(
        change("Object.prototype", "onUpdate", "getter", getter),
        readProperties,
      ),
    ).toBe("Object.prototype.onUpdate was replaced by native function max");
    expect(
      await intrinsicChangeFinding(
        change("Array.prototype", "filter", "removed", { type: "undefined" }),
        readProperties,
      ),
    ).toBe("Array.prototype.filter was removed");
    expect(
      await intrinsicChangeFinding(
        change("Element.prototype", "[[Prototype]]", "prototype", {
          type: "object",
          objectId: "x",
        }),
        readProperties,
      ),
    ).toBe("the prototype of Element.prototype was replaced");
  });

  it("lets the page assign data on the global object, and nowhere else", async () => {
    const number = { type: "number", value: 3 };
    expect(
      await intrinsicChangeFinding(change("globalThis", "name", "value", number), readProperties),
    ).toBeNull();
    expect(
      await intrinsicChangeFinding(change("Math", "PI", "value", number), readProperties),
    ).toBe("Math.PI was replaced by a number");
  });
});

describe("CAPTURE_SOURCE", () => {
  it("is plain text a transpiler never touched, evaluated as one expression", () => {
    expect(CAPTURE_SOURCE.startsWith("(function () {")).toBe(true);
    expect(CAPTURE_SOURCE.endsWith("})()")).toBe(true);
    expect(CAPTURE_SOURCE).not.toContain("__name");
  });
});
