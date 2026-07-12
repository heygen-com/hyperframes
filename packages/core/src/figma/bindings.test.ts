// @vitest-environment node
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendBinding,
  upsertBindings,
  findBindingByFigmaId,
  readBindings,
  readLibraryMap,
  recordLibraryFile,
  type FigmaBindingRecord,
} from "./bindings";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-bindings-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const REC: FigmaBindingRecord = {
  kind: "binding",
  figmaId: "VariableID:1:23",
  key: "abc123",
  sourceFileKey: "FILE",
  compositionVariableId: "figma:Blue/500",
  version: "7",
};

describe("bindings index", () => {
  it("round-trips binding records through .media/figma-bindings.jsonl", () => {
    expect(readBindings(dir)).toEqual([]);
    appendBinding(dir, REC);
    appendBinding(dir, {
      ...REC,
      figmaId: "VariableID:1:24",
      compositionVariableId: "figma:Red/500",
    });
    const all = readBindings(dir);
    expect(all).toHaveLength(2);
    expect(all[0]?.compositionVariableId).toBe("figma:Blue/500");
  });

  it("findBindingByFigmaId matches exact ids only — never values or names", () => {
    appendBinding(dir, REC);
    expect(findBindingByFigmaId(dir, "VariableID:1:23")?.key).toBe("abc123");
    expect(findBindingByFigmaId(dir, "VariableID:1:99")).toBeNull();
    expect(findBindingByFigmaId(dir, "Blue/500")).toBeNull();
  });

  it("matches alias-chain members too (semantic id bound, primitive in chain)", () => {
    appendBinding(dir, { ...REC, aliasChain: ["VariableID:9:1", "VariableID:1:23"] });
    expect(findBindingByFigmaId(dir, "VariableID:9:1")?.compositionVariableId).toBe(
      "figma:Blue/500",
    );
  });

  it("persists answered library-file mappings (asked once per project)", () => {
    expect(readLibraryMap(dir)).toEqual({});
    recordLibraryFile(dir, "libkey-1", "LIBFILE");
    expect(readLibraryMap(dir)).toEqual({ "libkey-1": "LIBFILE" });
  });

  it("skips malformed lines instead of crashing", () => {
    appendBinding(dir, REC);
    appendFileSync(join(dir, ".media", "figma-bindings.jsonl"), "not json\n");
    expect(readBindings(dir)).toHaveLength(1);
  });

  it("upsert replaces stale rows for re-imported figmaIds, keeps others + library rows", () => {
    appendBinding(dir, REC);
    appendBinding(dir, { ...REC, figmaId: "VariableID:2:2", compositionVariableId: "figma:Red" });
    recordLibraryFile(dir, "libkey-2", "LIB2");
    upsertBindings(dir, [{ ...REC, compositionVariableId: "figma:Blue/500-v2", version: "9" }]);
    const all = readBindings(dir);
    expect(all).toHaveLength(2);
    expect(findBindingByFigmaId(dir, REC.figmaId)?.compositionVariableId).toBe("figma:Blue/500-v2");
    expect(findBindingByFigmaId(dir, "VariableID:2:2")?.compositionVariableId).toBe("figma:Red");
    expect(readLibraryMap(dir)["libkey-2"]).toBe("LIB2");
  });
});
