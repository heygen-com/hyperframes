import { describe, expect, it, vi } from "vitest";
import { HTMLElement as LinkedomElement, HTMLTitleElement } from "linkedom";
import { parseHTML } from "./linkedom.js";

const BREAKOUT = "<script>window.pwned=1</script>";
const countScripts = (html: string) => parseHTML(html).document.querySelectorAll("script").length;

describe("@hyperframes/parsers/linkedom", () => {
  it("a parse and save keeps an escaped <title> escaped", () => {
    const src =
      "<!DOCTYPE html><html><head><title>a &lt;/title&gt;&lt;script&gt;t()&lt;/script&gt; &amp; b</title></head><body><p>hi</p></body></html>";
    const { document } = parseHTML(src);
    document.querySelector("p")!.textContent = "edited elsewhere";
    const out = document.toString();
    expect(countScripts(out)).toBe(0);
    expect(out).toContain(
      "<title>a &lt;/title&gt;&lt;script&gt;t()&lt;/script&gt; &amp; b</title>",
    );
  });

  it.each(["textarea", "TEXTAREA", "TextArea"])(
    "text set on a <textarea> can't close it (%s)",
    (tag) => {
      const { document } = parseHTML(
        "<!DOCTYPE html><html><body><div><textarea>old</textarea></div></body></html>",
      );
      document.querySelector("textarea")!.textContent = `</${tag}>${BREAKOUT}`;
      const out = document.toString();
      expect(countScripts(out)).toBe(0);
      expect(parseHTML(out).document.querySelectorAll("textarea").length).toBe(1);
    },
  );

  it("text set on a <title> can't close it", () => {
    const { document } = parseHTML(
      "<!DOCTYPE html><html><head><title>t</title></head><body></body></html>",
    );
    document.querySelector("title")!.textContent = `</title>${BREAKOUT}`;
    expect(countScripts(document.toString())).toBe(0);
  });

  it.each(["textarea", "title"])("a '><' in a <%s> attribute keeps the text out of it", (tag) => {
    const { document } = parseHTML(
      `<!DOCTYPE html><html><body><${tag} data-x="a><b">old</${tag}></body></html>`,
    );
    document.querySelector(tag)!.textContent = "new";
    const saved = parseHTML(document.toString()).document.querySelector(tag)!;
    expect(saved.getAttribute("data-x")).toBe("a><b");
    expect(saved.textContent).toBe("new");
  });

  it("a <textarea>'s source bytes round-trip unchanged", () => {
    const body = "<textarea>x &lt;y&gt; &amp; z</textarea><textarea>raw <b>tag</b></textarea>";
    const src = `<!DOCTYPE html><html><head></head><body>${body}</body></html>`;
    expect(parseHTML(src).document.toString()).toContain(body);
  });

  it("<script> and <style> text stays raw", () => {
    const body = "<script>if (a < b && c > d) go();</script><style>a > b { content: '&'; }</style>";
    const src = `<!DOCTYPE html><html><head></head><body>${body}</body></html>`;
    expect(parseHTML(src).document.toString()).toContain(body);
  });

  // When either fails, linkedom changed how it reads or writes these tags: re-check, or drop, the override.
  it("linkedom still decodes <title> and keeps <textarea> text as written", () => {
    const { document } = parseHTML("<title>a &lt;b&gt;</title><textarea>c &lt;d&gt;</textarea>");
    expect(document.querySelector("title")!.textContent).toBe("a <b>");
    expect(document.querySelector("textarea")!.textContent).toBe("c &lt;d&gt;");
  });

  // A plain re-export lets a bundler link straight to linkedom and drop this module under "sideEffects": false.
  it("parseHTML and DOMParser are this module's own functions, not linkedom's", async () => {
    const linkedom = await import("linkedom");
    const own = await import("./linkedom.js");
    expect(own.parseHTML).not.toBe(linkedom.parseHTML);
    expect(own.DOMParser).not.toBe(linkedom.DOMParser);
  });

  it("a fresh process escapes on save once a DOMParser is made", async () => {
    vi.resetModules();
    const linkedom = await import("linkedom");
    const { DOMParser } = await import("./linkedom.js");
    new DOMParser();
    const { document } = linkedom.parseHTML(
      "<!DOCTYPE html><html><body><textarea>x</textarea></body></html>",
    );
    document.querySelector("textarea")!.textContent = `</textarea>${BREAKOUT}`;
    expect(countScripts(document.toString())).toBe(0);
  });

  it("linkedom's own text-element writer is the one the override replaces", () => {
    const own = Object.getPrototypeOf(HTMLTitleElement.prototype).toString;
    expect(own).not.toBe(LinkedomElement.prototype.toString);
    expect(String(own).replace(/\s+/g, " ")).toBe(
      "toString() { const outerHTML = toString.call(this.cloneNode()); return outerHTML.replace('><', () => `>${this.textContent}<`); }",
    );
  });
});
