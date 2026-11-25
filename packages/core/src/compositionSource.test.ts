import { parseHTML } from "@hyperframes/parsers/linkedom";
import { describe, expect, it } from "vitest";
import { dropAuthoredCompositionFiles } from "./compositionSource";

// fails without the fix: linkedom's queries skip a template's children, so the drop cleaned only a copy of them.
describe("dropAuthoredCompositionFiles on a linkedom document", () => {
  const page = (body: string) => `<!DOCTYPE html><html><head></head><body>${body}</body></html>`;

  it("drops a mark inside a template at any depth", () => {
    const { document } = parseHTML(
      page(`<template><p data-composition-file="a.html">x</p>
        <template><b DATA-Composition-File="a.html">y</b></template></template>`),
    );
    dropAuthoredCompositionFiles(document);
    expect(document.toString()).not.toMatch(/data-composition-file/i);
  });

  it("leaves a template's content to be made from its children when it is first read", () => {
    const { document } = parseHTML(page("<template><p>before</p></template>"));
    dropAuthoredCompositionFiles(document);
    const template = document.querySelector("template") as HTMLTemplateElement;
    template.querySelector("p")!.textContent = "after";
    expect(template.content.firstChild?.textContent).toBe("after");
  });

  it("stops at the root it is given", () => {
    const { document } = parseHTML(
      page(
        '<div id="r"><p data-composition-file="a.html">x</p></div><p id="out" data-composition-file="b.html">y</p>',
      ),
    );
    dropAuthoredCompositionFiles(document.getElementById("r")!);
    expect(document.getElementById("out")?.getAttribute("data-composition-file")).toBe("b.html");
  });
});
