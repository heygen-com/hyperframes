import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import type { Page } from "puppeteer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractHtml } from "./htmlExtractor.js";

afterEach(() => vi.unstubAllGlobals());

async function extractStyles(head: string, sheets: Record<string, string | Response | Error>) {
  const window = new Window({
    url: "https://capture.example.com/",
    settings: { disableCSSFileLoading: true, disableJavaScriptEvaluation: true },
  });
  window.document.head.innerHTML = head;
  window.document.body.innerHTML = '<div class="hero"></div><div class="footer"></div>';
  const fetch = vi.fn(async (url: string) => {
    const sheet = sheets[url];
    if (sheet === undefined) throw new Error(`Unexpected stylesheet request: ${url}`);
    if (sheet instanceof Error) throw sheet;
    return typeof sheet === "string" ? new Response(sheet) : sheet;
  });
  vi.stubGlobal("fetch", fetch);
  const evaluate: Page["evaluate"] = async (script, ...args) =>
    runInNewContext(typeof script === "string" ? script : `(${script.toString()})(...args)`, {
      window,
      document: window.document,
      location: window.location,
      HTMLLinkElement: window.HTMLLinkElement,
      URL,
      args,
    });
  const page = {
    evaluate,
    url: () => window.location.href,
    addStyleTag: async ({ content }: { content?: string }) => {
      const style = window.document.createElement("style");
      style.textContent = content ?? "";
      window.document.head.append(style);
    },
  };
  try {
    const extracted = await extractHtml(page, { settleTime: 0 });
    const links = Array.from(window.document.querySelectorAll("link")).map((link) => link.href);
    const savedWindow = new Window({ settings: { disableCSSFileLoading: true } });
    try {
      savedWindow.document.head.innerHTML = extracted.headHtml;
      savedWindow.document.body.innerHTML = extracted.bodyHtml;
      const background = (selector: string) => {
        const element = savedWindow.document.querySelector(selector);
        if (!element) throw new Error(`Missing fixture element: ${selector}`);
        return savedWindow.getComputedStyle(element).backgroundColor;
      };
      return {
        extracted,
        links,
        hero: background(".hero"),
        footer: background(".footer"),
        requests: fetch.mock.calls.map(([url]) => url),
      };
    } finally {
      await savedWindow.happyDOM.close();
    }
  } finally {
    await window.happyDOM.close();
  }
}

describe("captured stylesheet cascade", () => {
  it("keeps a later inline override in the saved page", async () => {
    const result = await extractStyles(
      '<link rel="stylesheet" href="/theme.css"><style>.hero{background:rgb(0, 0, 255)}</style>',
      { "https://capture.example.com/theme.css": ".hero{background:rgb(255, 0, 0)}" },
    );

    expect(result.hero).toBe("rgb(0, 0, 255)");
    expect(result.links).toEqual([]);
    expect(result.requests).toEqual(["https://capture.example.com/theme.css"]);
  });

  it("keeps stylesheets on both sides of an inline style in order", async () => {
    const result = await extractStyles(
      '<link rel="stylesheet" href="/base.css"><style>.hero{background:rgb(0, 0, 255)}.footer{background:rgb(255, 0, 0)}</style><link rel="stylesheet" href="/footer.css">',
      {
        "https://capture.example.com/base.css": ".hero{background:rgb(255, 0, 0)}",
        "https://capture.example.com/footer.css": ".footer{background:rgb(0, 128, 0)}",
      },
    );

    expect(result.hero).toBe("rgb(0, 0, 255)");
    expect(result.footer).toBe("rgb(0, 128, 0)");
    expect(result.links).toEqual([]);
  });

  it("keeps repeated stylesheet links in their respective cascade positions", async () => {
    const result = await extractStyles(
      '<link rel="stylesheet" href="/theme.css"><style>.hero{background:rgb(0, 0, 255)}</style><link rel="stylesheet" href="/theme.css"><style>.hero{background:rgb(0, 128, 0)}</style>',
      { "https://capture.example.com/theme.css": ".hero{background:rgb(255, 0, 0)}" },
    );

    expect(result.hero).toBe("rgb(0, 128, 0)");
    expect(result.links).toEqual([]);
    expect(result.requests).toEqual([
      "https://capture.example.com/theme.css",
      "https://capture.example.com/theme.css",
    ]);
  });

  it("retains the linked stylesheet's print condition in the saved page", async () => {
    const result = await extractStyles(
      '<style>.hero{background:rgb(0, 0, 255)}</style><link rel="stylesheet" href="/print.css" media="print">',
      { "https://capture.example.com/print.css": ".hero{background:rgb(255, 0, 0)}" },
    );

    expect(result.extracted.headHtml).toContain('media="print"');
  });

  it("retains a stylesheet that already follows its inline override", async () => {
    const result = await extractStyles(
      '<style>.hero{background:rgb(0, 0, 255)}</style><link rel="stylesheet" href="/theme.css">',
      { "https://capture.example.com/theme.css": ".hero{background:rgb(255, 0, 0)}" },
    );

    expect(result.hero).toBe("rgb(255, 0, 0)");
    expect(result.links).toEqual([]);
  });

  it.each([new Response("Unavailable", { status: 503 }), new Error("Network unavailable")])(
    "leaves the link intact when its stylesheet cannot be fetched: %s",
    async (failure) => {
      const result = await extractStyles(
        '<link rel="stylesheet" href="/theme.css"><style>.hero{background:rgb(0, 0, 255)}</style>',
        { "https://capture.example.com/theme.css": failure },
      );

      expect(result.hero).toBe("rgb(0, 0, 255)");
      expect(result.links).toEqual(["https://capture.example.com/theme.css"]);
    },
  );

  it("resolves relative CSS assets against the original stylesheet URL", async () => {
    const result = await extractStyles('<link rel="stylesheet" href="/css/theme.css">', {
      "https://capture.example.com/css/theme.css":
        ".hero{background-image:url(../assets/hero.png)}",
    });

    expect(result.extracted.headHtml).toContain(
      "url('https://capture.example.com/assets/hero.png')",
    );
  });
});
