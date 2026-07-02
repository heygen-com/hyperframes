// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveBindings } from "./resolveBindings";
import type { FigmaBindingRecord } from "./bindings";
import type { FigmaNodeDocument } from "./client";

const INDEX: FigmaBindingRecord[] = [
  {
    kind: "binding",
    figmaId: "VariableID:1:1",
    key: "kblue",
    sourceFileKey: "FILE",
    compositionVariableId: "figma:Blue/500",
    version: "7",
  },
  {
    kind: "binding",
    figmaId: "VariableID:1:2",
    key: "kbtn",
    sourceFileKey: "FILE",
    aliasChain: ["VariableID:1:2", "VariableID:1:1"],
    compositionVariableId: "figma:button/bg",
    version: "7",
  },
];

function node(overrides: Partial<FigmaNodeDocument>): FigmaNodeDocument {
  return { id: "9:9", name: "n", type: "RECTANGLE", ...overrides };
}

describe("resolveBindings", () => {
  it("resolves a fill bound to an indexed variable", () => {
    const doc = node({
      boundVariables: { fills: [{ type: "VARIABLE_ALIAS", id: "VariableID:1:1" }] },
    });
    const out = resolveBindings(doc, INDEX);
    expect(out.resolved).toEqual([
      {
        nodeId: "9:9",
        property: "fills",
        figmaId: "VariableID:1:1",
        compositionVariableId: "figma:Blue/500",
      },
    ]);
    expect(out.unresolved).toEqual([]);
  });

  it("resolves via alias chain membership (semantic id indexed under chain)", () => {
    const doc = node({
      boundVariables: { fills: [{ type: "VARIABLE_ALIAS", id: "VariableID:1:2" }] },
    });
    const out = resolveBindings(doc, INDEX);
    expect(out.resolved[0]?.compositionVariableId).toBe("figma:button/bg");
  });

  it("partitions unknown ids as unresolved — exact-ID only, no value matching", () => {
    const doc = node({
      boundVariables: { fills: [{ type: "VARIABLE_ALIAS", id: "VariableID:99:1" }] },
    });
    const out = resolveBindings(doc, INDEX);
    expect(out.resolved).toEqual([]);
    expect(out.unresolved).toEqual([
      { nodeId: "9:9", property: "fills", figmaId: "VariableID:99:1" },
    ]);
  });

  it("walks children and collects style-id sites too", () => {
    const doc = node({
      type: "FRAME",
      children: [
        node({
          id: "9:10",
          type: "TEXT",
          styles: { text: "S:styleKey1" },
        }),
      ],
    });
    const out = resolveBindings(doc, INDEX);
    expect(out.unresolved).toEqual([
      { nodeId: "9:10", property: "style:text", figmaId: "S:styleKey1" },
    ]);
  });

  it("returns empty partitions for an unbound tree", () => {
    const out = resolveBindings(node({}), INDEX);
    expect(out).toEqual({ resolved: [], unresolved: [] });
  });
});
