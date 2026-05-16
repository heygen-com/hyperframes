import { describe, expect, it } from "vitest";
import { serializeDomEditTextFields } from "./domEditing";

describe("serializeDomEditTextFields — mixed content", () => {
  it("round-trips text-node + child element fields", () => {
    expect(
      serializeDomEditTextFields([
        {
          key: "text-node:0",
          label: "Text 1",
          value: "If you're ",
          tagName: "#text",
          attributes: [],
          inlineStyles: {},
          computedStyles: {},
          source: "text-node",
        },
        {
          key: "child:1:span",
          label: "Text 2",
          value: "turning 65",
          tagName: "span",
          attributes: [{ name: "class", value: "accent" }],
          inlineStyles: { color: "red" },
          computedStyles: {},
          source: "child",
        },
        {
          key: "text-node:2",
          label: "Text 3",
          value: " soon...",
          tagName: "#text",
          attributes: [],
          inlineStyles: {},
          computedStyles: {},
          source: "text-node",
        },
      ]),
    ).toBe(
      `If you're <span class="accent" data-hf-text-key="child:1:span" style="color: red">turning 65</span> soon...`,
    );
  });

  it("escapes HTML entities in text-node values", () => {
    expect(
      serializeDomEditTextFields([
        {
          key: "text-node:0",
          label: "Text 1",
          value: "A < B & C > D",
          tagName: "#text",
          attributes: [],
          inlineStyles: {},
          computedStyles: {},
          source: "text-node",
        },
      ]),
    ).toBe("A &lt; B &amp; C &gt; D");
  });
});
