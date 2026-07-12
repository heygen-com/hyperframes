// @vitest-environment node
import { describe, expect, it } from "vitest";
import { tokensToVariables } from "./tokensToVariables";
import type { FigmaVariablesResult } from "./client";

const VARS: FigmaVariablesResult = {
  variables: {
    "VariableID:1:1": {
      name: "Blue/500",
      key: "kblue",
      resolvedType: "COLOR",
      valuesByMode: { m1: { r: 0, g: 0.4, b: 1, a: 1 } },
      variableCollectionId: "c1",
    },
    "VariableID:1:2": {
      name: "button/bg",
      key: "kbtn",
      resolvedType: "COLOR",
      valuesByMode: { m1: { type: "VARIABLE_ALIAS", id: "VariableID:1:1" } },
      variableCollectionId: "c1",
    },
    "VariableID:1:3": {
      name: "radius/md",
      key: "krad",
      resolvedType: "FLOAT",
      valuesByMode: { m1: 8 },
      variableCollectionId: "c1",
    },
  },
  variableCollections: {
    c1: { defaultModeId: "m1", modes: [{ modeId: "m1", name: "Light" }] },
  },
};

const SOURCE = { fileKey: "FILE", version: "7" };

describe("tokensToVariables", () => {
  it("maps color variables to composition color entries with hex defaults", () => {
    const out = tokensToVariables(VARS, SOURCE);
    const blue = out.entries.find((e) => e.id === "figma:Blue/500");
    expect(blue).toMatchObject({ type: "color", label: "Blue/500", default: "#0066FF" });
  });

  it("resolves alias chains to the leaf value and records the chain on the binding", () => {
    const out = tokensToVariables(VARS, SOURCE);
    const btn = out.entries.find((e) => e.id === "figma:button/bg");
    expect(btn?.default).toBe("#0066FF");
    const binding = out.bindings.find((b) => b.figmaId === "VariableID:1:2");
    expect(binding?.aliasChain).toEqual(["VariableID:1:2", "VariableID:1:1"]);
    expect(binding?.compositionVariableId).toBe("figma:button/bg");
  });

  it("maps FLOAT to number entries and stamps provenance on every binding", () => {
    const out = tokensToVariables(VARS, SOURCE);
    const rad = out.entries.find((e) => e.id === "figma:radius/md");
    expect(rad).toMatchObject({ type: "number", default: 8 });
    for (const b of out.bindings) {
      expect(b.sourceFileKey).toBe("FILE");
      expect(b.version).toBe("7");
      expect(b.kind).toBe("binding");
    }
  });

  it("emits an alpha color as rgba()", () => {
    const out = tokensToVariables(
      {
        variables: {
          "VariableID:2:1": {
            name: "overlay",
            resolvedType: "COLOR",
            valuesByMode: { m1: { r: 0, g: 0, b: 0, a: 0.5 } },
          },
        },
        variableCollections: {},
      },
      SOURCE,
    );
    expect(out.entries[0]?.default).toBe("rgba(0, 0, 0, 0.5)");
  });

  it("survives alias cycles without hanging and skips the unresolvable variable", () => {
    const out = tokensToVariables(
      {
        variables: {
          "VariableID:3:1": {
            name: "a",
            resolvedType: "COLOR",
            valuesByMode: { m1: { type: "VARIABLE_ALIAS", id: "VariableID:3:2" } },
          },
          "VariableID:3:2": {
            name: "b",
            resolvedType: "COLOR",
            valuesByMode: { m1: { type: "VARIABLE_ALIAS", id: "VariableID:3:1" } },
          },
        },
        variableCollections: {},
      },
      SOURCE,
    );
    expect(out.entries).toEqual([]);
  });

  it("writes a sidecar with every token including modes", () => {
    const out = tokensToVariables(VARS, SOURCE);
    expect(out.sidecar.source).toEqual(SOURCE);
    const blue = out.sidecar.tokens.find((t) => t.name === "Blue/500");
    expect(blue).toMatchObject({ figmaId: "VariableID:1:1", key: "kblue", type: "color" });
  });
});

describe("tokensToVariables collection semantics", () => {
  const TWO_COLLECTIONS: FigmaVariablesResult = {
    variables: {
      "VariableID:9:1": {
        name: "Blue/500",
        resolvedType: "COLOR",
        valuesByMode: { m1: { r: 0, g: 0, b: 1, a: 1 } },
        variableCollectionId: "sem",
      },
      "VariableID:9:2": {
        name: "Blue/500",
        resolvedType: "COLOR",
        valuesByMode: { m1: { r: 0, g: 0.5, b: 1, a: 1 } },
        variableCollectionId: "prim",
      },
    },
    variableCollections: {
      sem: { name: "Semantic", defaultModeId: "m1" },
      prim: { name: "Primitive", defaultModeId: "m1" },
    },
  };

  it("namespaces composition ids by collection so same-name variables never collide", () => {
    const out = tokensToVariables(TWO_COLLECTIONS, { fileKey: "F", version: "1" });
    const ids = out.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain("figma:Semantic/Blue/500");
    expect(ids).toContain("figma:Primitive/Blue/500");
  });

  it("prefers the collection defaultModeId over insertion order", () => {
    const multiMode: FigmaVariablesResult = {
      variables: {
        "VariableID:9:3": {
          name: "Ink",
          resolvedType: "COLOR",
          valuesByMode: {
            dark: { r: 1, g: 1, b: 1, a: 1 },
            light: { r: 0, g: 0, b: 0, a: 1 },
          },
          variableCollectionId: "c",
        },
      },
      variableCollections: { c: { name: "Modes", defaultModeId: "light" } },
    };
    const out = tokensToVariables(multiMode, { fileKey: "F", version: "1" });
    expect(out.entries[0]?.default).toBe("#000000");
  });

  it("rejects type-mismatched values (stringified FLOAT) instead of passing them through", () => {
    const bad: FigmaVariablesResult = {
      variables: {
        "VariableID:9:4": {
          name: "Gap",
          resolvedType: "FLOAT",
          valuesByMode: { m1: "8" },
          variableCollectionId: "c",
        },
      },
      variableCollections: { c: { name: "N", defaultModeId: "m1" } },
    };
    const out = tokensToVariables(bad, { fileKey: "F", version: "1" });
    expect(out.entries).toHaveLength(0);
  });
});
