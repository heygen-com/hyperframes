import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TextClipContent, textClipBackground } from "./TextClipContent";

describe("textClipBackground", () => {
  it("puts dark text on a light strip and light text on a dark one", () => {
    expect(textClipBackground({ value: "a", color: "rgb(16, 20, 24)" })).toBe(
      "var(--timeline-text-clip-light-bg)",
    );
    expect(textClipBackground({ value: "a", color: "rgb(255, 255, 255)" })).toBe(
      "var(--timeline-text-clip-dark-bg)",
    );
  });

  it("uses the layer's own background when it paints one", () => {
    expect(
      textClipBackground({ value: "a", color: "rgb(16, 20, 24)", background: "rgb(230, 57, 70)" }),
    ).toBe("rgb(230, 57, 70)");
  });
});

describe("TextClipContent", () => {
  it("shows a film's words as plain text, never as markup", () => {
    const value = '<img src="x" onerror="alert(1)"><b>Title</b>';
    const html = renderToStaticMarkup(createElement(TextClipContent, { text: { value } }));

    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain(
      "&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;&lt;b&gt;Title&lt;/b&gt;",
    );
  });
});
