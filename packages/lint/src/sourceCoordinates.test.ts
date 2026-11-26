import { describe, expect, it } from "vitest";
import { sourcePositions } from "./sourceCoordinates";

const ONE_CODE_UNIT = new Set<string | symbol>(["at", "charAt", "charCodeAt", "codePointAt"]);

// Charges every read of the source, whatever API makes it. An index or a one-character method reads one code unit.
// Any other method, or turning the source into a plain string, reads all of it.
function chargedSource(text: string): { source: string; reads: () => number } {
  let reads = 0;
  const source = new Proxy(new String(text), {
    get(target, key) {
      if (key === "length") return text.length;
      if (typeof key === "string" && /^\d+$/.test(key)) {
        reads += 1;
        return text[Number(key)];
      }
      const value: unknown = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        reads += ONE_CODE_UNIT.has(key) ? 1 : text.length;
        return (value as (...a: unknown[]) => unknown).apply(text, args);
      };
    },
  });
  return { source: source as unknown as string, reads: () => reads };
}

// fails without the fix: a position found by rescanning the text before it made many findings quadratic.
describe("sourcePositions", () => {
  it("reads the source a number of times that grows with its length, not with the positions asked for", () => {
    const readsFor = (lines: number) => {
      const text = "ab\n".repeat(lines);
      const { source, reads } = chargedSource(text);
      const position = sourcePositions(source);
      for (let offset = 0; offset < text.length; offset += 3) position(offset);
      return reads();
    };
    // From n to 4n lines a single pass grows 4x and a pass per position 16x.
    expect(readsFor(4000) / readsFor(1000)).toBeLessThan(6);
  });

  it("finds lines and columns through the charged source as through the plain one", () => {
    const text = "a\r\nbc\rd\ne";
    const { source } = chargedSource(text);
    const charged = sourcePositions(source);
    const plain = sourcePositions(text);
    for (let offset = 0; offset <= text.length; offset++)
      expect(charged(offset)).toEqual(plain(offset));
  });
});
