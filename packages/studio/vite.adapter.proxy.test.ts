import { describe, expect, it } from "vitest";
import { resolveViteAutoProxy } from "./vite.adapter";

describe("resolveViteAutoProxy", () => {
  it("honors the CLI child environment and defaults direct Vite launches on", () => {
    expect(resolveViteAutoProxy("true")).toBe(true);
    expect(resolveViteAutoProxy("false")).toBe(false);
    expect(resolveViteAutoProxy(undefined)).toBe(true);
  });
});
