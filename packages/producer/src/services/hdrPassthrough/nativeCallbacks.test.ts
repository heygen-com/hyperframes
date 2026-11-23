import { describe, expect, it } from "bun:test";
import {
  nonScriptCallable,
  nonScriptListener,
  type PropertiesLike,
  type ReadProperties,
  type RemoteObjectLike,
} from "./nativeCallbacks.js";

/** A fake `Runtime.getProperties`: object id -> what CDP would report for it. */
function properties(table: Record<string, PropertiesLike>): ReadProperties {
  return async (objectId) => {
    const found = table[objectId];
    if (!found) throw new Error(`no properties for ${objectId}`);
    return found;
  };
}

const fn = (objectId: string, description: string): RemoteObjectLike => ({
  type: "function",
  className: "Function",
  description,
  objectId,
});
const located = {
  name: "[[FunctionLocation]]",
  value: { type: "object", subtype: "internal#location" },
};
const proxy = (objectId: string): RemoteObjectLike => ({
  type: "object",
  subtype: "proxy",
  objectId,
});
const object = (objectId: string): RemoteObjectLike => ({
  type: "object",
  className: "Object",
  objectId,
});
const nullProto = { name: "[[Prototype]]", value: { type: "object", subtype: "null" } };

const TABLE = properties({
  js: { result: [], internalProperties: [located] },
  native: { result: [], internalProperties: [] },
  wasm: { result: [], internalProperties: [located] },
  "bound-js": {
    result: [],
    internalProperties: [{ name: "[[TargetFunction]]", value: fn("js", "function f() {}") }],
  },
  "bound-native": {
    result: [],
    internalProperties: [
      {
        name: "[[TargetFunction]]",
        value: fn("native", "function showPopover() { [native code] }"),
      },
    ],
  },
  "proxy-js-trap": {
    result: [],
    internalProperties: [
      { name: "[[Handler]]", value: object("handler-js") },
      { name: "[[Target]]", value: object("target") },
    ],
  },
  "handler-js": {
    result: [{ name: "get", value: fn("js", "get(t, k) { return t[k]; }") }],
    internalProperties: [nullProto],
  },
  "proxy-native-trap": {
    result: [],
    internalProperties: [
      { name: "[[Handler]]", value: object("handler-native") },
      { name: "[[Target]]", value: object("target") },
    ],
  },
  "handler-native": {
    result: [{ name: "set", value: fn("bound-native", "function () { [native code] }") }],
    internalProperties: [nullProto],
  },
  "proxy-inherited-trap": {
    result: [],
    internalProperties: [{ name: "[[Handler]]", value: object("handler-child") }],
  },
  "handler-child": {
    result: [{ name: "note", value: fn("native", "function log() { [native code] }") }],
    internalProperties: [{ name: "[[Prototype]]", value: object("handler-native") }],
  },
  "proxy-of-native": {
    result: [],
    internalProperties: [
      { name: "[[Handler]]", value: object("empty") },
      { name: "[[Target]]", value: fn("native", "function showPopover() { [native code] }") },
    ],
  },
  empty: { result: [], internalProperties: [nullProto] },
});

describe("nonScriptCallable", () => {
  it.each<[string, RemoteObjectLike]>([
    ["a function compiled from source", fn("js", "function f() {}")],
    ["a bound page function", fn("bound-js", "function () { [native code] }")],
    ["a Proxy with page-script traps", proxy("proxy-js-trap")],
  ])("passes %s, whose calls V8 counts", async (_label, remote) => {
    expect(await nonScriptCallable(remote, TABLE)).toBeNull();
  });

  it.each<[string, RemoteObjectLike, string]>([
    ["a builtin", fn("native", "function log() { [native code] }"), "native function log"],
    [
      "a bound builtin",
      fn("bound-native", "function () { [native code] }"),
      "native function showPopover",
    ],
    ["a WebAssembly export", fn("wasm", "function $f() { [native code] }"), "native function $f"],
    [
      "a Proxy with a builtin trap",
      proxy("proxy-native-trap"),
      "a Proxy whose set trap is native function showPopover",
    ],
    [
      "a Proxy whose handler inherits a builtin trap",
      proxy("proxy-inherited-trap"),
      "a Proxy whose set trap is native function showPopover",
    ],
    ["a Proxy of a builtin", proxy("proxy-of-native"), "a Proxy of native function showPopover"],
  ])("reports %s", async (_label, remote, finding) => {
    expect(await nonScriptCallable(remote, TABLE)).toBe(finding);
  });

  it("reports what it cannot read", async () => {
    expect(await nonScriptCallable({ type: "function" }, TABLE)).toBe("an unreadable function");
  });
});

describe("nonScriptListener", () => {
  it("passes a page function and reports a builtin", async () => {
    expect(
      await nonScriptListener(
        { type: "x", scriptId: "3", handler: fn("js", "function f() {}") },
        TABLE,
      ),
    ).toBeNull();
    expect(
      await nonScriptListener(
        { type: "x", scriptId: "0", handler: fn("native", "function log() { [native code] }") },
        TABLE,
      ),
    ).toBe("native function log");
  });

  it("reports a listener object, whose handleEvent is read at dispatch", async () => {
    expect(
      await nonScriptListener({ type: "x", scriptId: "3", handler: object("empty") }, TABLE),
    ).toBe("a listener object");
  });

  it("reports a listener whose handler CDP did not return", async () => {
    expect(await nonScriptListener({ type: "x", scriptId: "3" }, TABLE)).toBe(
      "an unreadable handler",
    );
  });
});
