import { describe, expect, it } from "vitest";
import * as clipboard from "./elementClipboard";

const value = {
  html: "<div><span>Editable</span></div>",
  css: "span { color: red }",
  width: 320,
  height: 180,
  warnings: ["Missing image"],
};
const wire = (changes = {}) =>
  "hyperframes-element:v1\n" + JSON.stringify({ ...value, ...changes });

describe("element clipboard contract", () => {
  it("roundtrips only the public fields as versioned text", () => {
    expect(clipboard.parseElementClipboard(clipboard.encodeElementClipboard(value))).toEqual(value);
    expect(clipboard.encodeElementClipboard(value)).toBe(wire());
  });
  it("rejects foreign, malformed and future-version text", () => {
    for (const text of [
      "",
      "{}",
      "hyperframes-element:v2\n{}",
      "hyperframes-element:v1\n{",
      wire({ html: 3 }),
      wire({ warnings: [3] }),
    ])
      expect(clipboard.parseElementClipboard(text)).toBeNull();
  });
  it("bounds dimensions, warnings, nodes and UTF-8 bytes", () => {
    for (const change of [
      { width: 0 },
      { height: -1 },
      { width: Infinity },
      { height: 16385 },
      { html: "<i></i>".repeat(5001) },
      { html: "é".repeat(4 * 1024 * 1024) },
      { warnings: Array(33).fill("x") },
      { warnings: ["x".repeat(513)] },
    ]) {
      expect(clipboard.parseElementClipboard(wire(change))).toBeNull();
      expect(() => clipboard.encodeElementClipboard({ ...value, ...change })).toThrow(TypeError);
    }
  });
  it("does not carry unknown metadata into the receiver", () => {
    expect(clipboard.parseElementClipboard(wire({ sourceUrl: "secret" }))).toEqual(value);
    expect(clipboard.encodeElementClipboard({ ...value, sourceUrl: "secret" })).not.toContain(
      "secret",
    );
  });
});
