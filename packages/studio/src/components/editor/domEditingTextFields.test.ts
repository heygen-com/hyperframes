import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import {
  PREVIEW_RASTER_ATTR,
  STUDIO_PREVIEW_UPCOMING_ATTR,
} from "@hyperframes/core/studio-preview-mark";
import { patchElementInHtml } from "@hyperframes/studio-server/source-mutation";
import { serializeDomEditTextFields, type DomEditTextField } from "./domEditing";
import { buildDefaultDomEditTextField, collectDomEditTextFields } from "./domEditingLayers";
import { planDomTextCommit, spacedAround } from "../../hooks/domEditTextCommitPlan";

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

describe("collectDomEditTextFields — preview marks", () => {
  it("keeps preview-only attributes out of a saved text edit", () => {
    const { document } = new Window();
    document.body.innerHTML = `<h1>Hello <span class="word" ${PREVIEW_RASTER_ATTR} ${STUDIO_PREVIEW_UPCOMING_ATTR}>world</span></h1>`;
    const heading = document.querySelector("h1") as unknown as HTMLElement;
    const saved = serializeDomEditTextFields(collectDomEditTextFields(heading));
    expect(saved).toContain('<span class="word" data-hf-text-key=');
    expect(saved).not.toContain(PREVIEW_RASTER_ATTR);
    expect(saved).not.toContain(STUDIO_PREVIEW_UPCOMING_ATTR);
  });
});

describe("text fields — spaces between child elements", () => {
  const SPANS = "<span>One</span> <span>Two</span>";
  const heading = (markup: string) => {
    const { document } = new Window();
    document.body.innerHTML = `<h1 id="title">${markup}</h1>`;
    return document.getElementById("title") as unknown as HTMLElement;
  };
  const unstamped = (html: string) => html.replace(/ data-hf-[a-z-]+="[^"]*"/g, "");
  const written = (markup: string, next: (fields: DomEditTextField[]) => DomEditTextField[]) => {
    const fields = collectDomEditTextFields(heading(markup));
    const plan = planDomTextCommit(fields, next(fields), "");
    const source = `<h1 id="title">${markup}</h1>`;
    const { document } = new Window();
    document.body.innerHTML = patchElementInHtml(source, { id: "title" }, plan.operations).html;
    return unstamped(document.getElementById("title")!.innerHTML);
  };

  it.each([SPANS, "Hello <span>big</span> <span>world</span>"])(
    "writes %s back with its spaces",
    (markup) => {
      expect(unstamped(serializeDomEditTextFields(collectDomEditTextFields(heading(markup))))).toBe(
        markup,
      );
    },
  );

  it("keeps the spaces when a field is added from the panel", () => {
    const html = written(SPANS, (fields) => [...fields, buildDefaultDomEditTextField(fields[1])]);
    expect(html).toMatch(/^<span>One<\/span> <span>Two<\/span><span[^>]*>New text<\/span>$/);
  });

  it("keeps the spaces when a field is removed from the panel", () => {
    expect(written(`${SPANS} <span>Three</span>`, (fields) => [fields[0]!, fields[2]!])).toBe(
      "<span>One</span> <span>Three</span>",
    );
  });
});

describe("text fields — the spaces around a field added from the panel", () => {
  const field = (key: string, value: string, spaceBefore?: string): DomEditTextField => ({
    ...buildDefaultDomEditTextField(),
    key,
    value,
    ...(spaceBefore === undefined ? {} : { spaceBefore }),
  });
  const spaces = (fields: DomEditTextField[]) =>
    spacedAround(fields, "new").map((entry) => entry.spaceBefore ?? "");

  it.each([
    ["after a word", [field("a", "Hello"), field("new", "again")], ["", " "]],
    ["after text ending in a space", [field("a", "Hello "), field("new", "again")], ["", ""]],
    ["starting with punctuation", [field("a", "Hello"), field("new", ", again")], ["", ""]],
    ["with no text before it", [field("new", "again"), field("b", "world", " ")], ["", " "]],
    ["after empty text", [field("a", ""), field("new", "again")], ["", ""]],
    [
      "between two words",
      [field("a", "Hello "), field("new", "again"), field("b", "world")],
      ["", "", " "],
    ],
    [
      "before punctuation",
      [field("a", "Hello"), field("new", "world"), field("b", "!")],
      ["", " ", ""],
    ],
    [
      "ending in a space",
      [field("a", "Hello "), field("new", "again "), field("b", "world")],
      ["", "", ""],
    ],
    [
      "between authored spaces",
      [field("a", "One"), field("new", "new", " "), field("b", "Two", " ")],
      ["", " ", " "],
    ],
  ])("%s", (_, fields, expected) => {
    expect(spaces(fields)).toEqual(expected);
  });
});
