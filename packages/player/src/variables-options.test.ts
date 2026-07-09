import { describe, expect, it } from "vitest";
import {
  injectBaseHrefIntoSrcdoc,
  injectVariablesIntoSrcdoc,
  isSameOriginUrl,
} from "./variables-options.js";

describe("variables srcdoc helpers", () => {
  it("injects variables as the first script tag in head", () => {
    const srcdoc =
      '<!doctype html><html><head><meta charset="utf-8"><script src="composition.js"></script></head><body></body></html>';

    const injected = injectVariablesIntoSrcdoc(srcdoc, { title: "Hello" });

    expect(injected).toContain('window.__hfVariables = {"title":"Hello"};');
    expect(injected.indexOf("window.__hfVariables")).toBeLessThan(
      injected.indexOf("composition.js"),
    );
    expect(injected.match(/<script\b/gi)?.length).toBe(2);
  });

  it("keeps an existing leading base tag before the variables script without duplicating it", () => {
    const srcdoc =
      '<!doctype html><html><head><base href="https://cdn.example/assets/"><script src="composition.js"></script></head><body></body></html>';

    const injected = injectVariablesIntoSrcdoc(srcdoc, { title: "Hello" });

    expect(injected.match(/<base\b/gi)?.length).toBe(1);
    expect(injected.indexOf("<base")).toBeLessThan(injected.indexOf("window.__hfVariables"));
    expect(injected.indexOf("window.__hfVariables")).toBeLessThan(
      injected.indexOf("composition.js"),
    );
  });

  it("escapes markup in JSON values so they cannot break out of the script tag", () => {
    const injected = injectVariablesIntoSrcdoc("<html><head></head><body></body></html>", {
      title: '</script><img src="x" onerror="alert(1)">',
    });

    expect(injected).toContain("\\u003C/script>");
    expect(injected).toContain("\\u003Cimg");
    expect(injected).not.toContain('</script><img src="x"');
    expect(injected.match(/<script\b/gi)?.length).toBe(1);
  });

  it("inserts a base tag as the first thing in head", () => {
    const srcdoc =
      '<!doctype html><html><head><script>window.original = true;</script></head><body><img src="./hero.png"></body></html>';

    const injected = injectBaseHrefIntoSrcdoc(
      srcdoc,
      "https://example.com/videos/intro/index.html",
    );

    expect(injected).toContain('<head><base href="https://example.com/videos/intro/index.html">');
    expect(injected.indexOf("<base")).toBeLessThan(injected.indexOf("window.original"));
  });

  it("does not add a base tag when the document already supplies one", () => {
    const srcdoc =
      '<!doctype html><html><head><base href="https://cdn.example/assets/"><script src="composition.js"></script></head></html>';

    const injected = injectBaseHrefIntoSrcdoc(
      srcdoc,
      "https://example.com/videos/intro/index.html",
    );

    expect(injected.match(/<base\b/gi)?.length).toBe(1);
    expect(injected).toContain('<base href="https://cdn.example/assets/">');
  });

  it("compares URLs by origin after resolving against a base URL", () => {
    const base = "https://example.com/projects/demo/page.html";

    expect(isSameOriginUrl("./composition.html", base)).toBe(true);
    expect(isSameOriginUrl("https://example.com/other.html", base)).toBe(true);
    expect(isSameOriginUrl("https://other-origin.example/comp.html", base)).toBe(false);
  });
});
