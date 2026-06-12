import { describe, expect, it } from "vitest";
import type { RegistryItem } from "@hyperframes/core";
import { checkRegistryItemCompatibility } from "./compatibility.js";

const BASE_ITEM: RegistryItem = {
  name: "demo-block",
  type: "hyperframes:block",
  title: "Demo Block",
  description: "Block for tests",
  dimensions: { width: 1080, height: 1350 },
  duration: 6,
  files: [
    {
      path: "demo-block.html",
      target: "compositions/demo-block.html",
      type: "hyperframes:composition",
    },
  ],
};

describe("checkRegistryItemCompatibility", () => {
  it("returns no warning or error for compatible items", () => {
    expect(checkRegistryItemCompatibility(BASE_ITEM, "0.6.79")).toEqual({ warnings: [] });
  });

  it("returns a warning for deprecated items", () => {
    const result = checkRegistryItemCompatibility(
      { ...BASE_ITEM, deprecated: "Use `demo-block-v2` instead." },
      "0.6.79",
    );
    expect(result).toEqual({
      warnings: ['Registry item "demo-block" is deprecated: Use `demo-block-v2` instead.'],
    });
  });

  it("returns an error when the current CLI is below minCliVersion", () => {
    const result = checkRegistryItemCompatibility(
      { ...BASE_ITEM, minCliVersion: "0.6.80" },
      "0.6.79",
    );
    expect(result.error).toContain('Registry item "demo-block" requires hyperframes >= 0.6.80');
  });

  it("allows source/dev CLI builds to install future-gated registry items", () => {
    expect(
      checkRegistryItemCompatibility({ ...BASE_ITEM, minCliVersion: "999.0.0" }, "0.0.0-dev"),
    ).toEqual({ warnings: [] });
  });

  it("returns a clear error for malformed minCliVersion metadata", () => {
    const result = checkRegistryItemCompatibility(
      { ...BASE_ITEM, minCliVersion: "next" },
      "0.6.79",
    );
    expect(result.error).toContain('declares invalid minCliVersion "next"');
  });
});
