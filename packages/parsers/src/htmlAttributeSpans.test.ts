import { describe, expect, it } from "vitest";
import { scanHtmlOpeningTags, decodeAuthoredAttribute } from "./htmlAttributeSpans.js";

describe("HTML source attribute spans", () => {
  it("uses browser entity casing and numeric replacement semantics", () => {
    expect(decodeAuthoredAttribute("a&aMp;b&#128;&copy;.png")).toBe("a&aMp;b€©.png");
  });
  it("does not scan element-looking fallback text inside raw text elements", () => {
    expect(
      scanHtmlOpeningTags(
        `<iframe><video src="fake.mp4"></video></iframe><video src="real.mp4">`,
      ).map((tag) => tag.name),
    ).toEqual(["iframe", "video"]);
  });

  it("keeps quoted attribute-looking content separate from actual attributes", () => {
    const html = `<video title="src='fake.mp4' >" data-src="lazy.mp4" src="it's.mp4" muted>`;
    const [tag] = scanHtmlOpeningTags(html);
    expect(tag?.closed).toBe(true);
    expect(
      tag?.attributes.map((attr) => [attr.name, attr.kind === "value" ? attr.value : true]),
    ).toEqual([
      ["title", "src='fake.mp4' >"],
      ["data-src", "lazy.mp4"],
      ["src", "it's.mp4"],
      ["muted", true],
    ]);
    const source = tag?.attributes.find((attr) => attr.name === "src");
    expect(source?.kind === "value" ? html.slice(source.valueStart, source.valueEnd) : null).toBe(
      "it's.mp4",
    );
  });
  it("skips commented and raw text tags while retaining unquoted values", () => {
    const tags = scanHtmlOpeningTags(
      `<!-- <img src=comment.png> --><script>"<img src=fake.png>"</script><img src=real.png>`,
    );
    expect(tags.map((tag) => tag.name)).toEqual(["script", "img"]);
    expect(tags[1]?.attributes[0]).toMatchObject({ kind: "value", value: "real.png", quote: "" });
  });
  it("decodes the authored grammar once including numeric quote and backslash entities", () => {
    expect(decodeAuthoredAttribute("a&amp;quot;&#39;&#92;&#x20;b")).toBe("a&quot;'\\ b");
  });
});
