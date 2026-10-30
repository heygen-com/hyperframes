import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import type { Page } from "puppeteer-core";
import { downloadAndRewriteFonts } from "./assetDownloader.js";
import { extractHtml } from "./htmlExtractor.js";
import { publicRequest } from "./publicNetwork.js";

vi.mock("./publicNetwork.js", () => ({ publicRequest: vi.fn() }));

const FONT = readFileSync(
  new URL("../../../../docs/public/catalog/assets/a634cb9e7783af7e.woff2", import.meta.url),
);

function fakePage(window: Window): Page {
  const evaluate = async (script: unknown, ...args: unknown[]) => {
    const expression = typeof script === "function" ? `(${script.toString()})(...args)` : script;
    if (typeof expression !== "string") throw new Error("Expected a page expression");
    return runInNewContext(expression, {
      args,
      window,
      document: window.document,
      location: window.location,
      HTMLLinkElement: window.HTMLLinkElement,
      URL,
    });
  };
  const addStyleTag = async ({ content }: { content: string }) => {
    const style = window.document.createElement("style");
    style.textContent = content;
    window.document.head.append(style);
  };
  return { evaluate, addStyleTag, url: () => window.location.href } as unknown as Page;
}

afterEach(() => {
  vi.mocked(publicRequest).mockReset();
});

async function extractStyles(head: string, sheets: Record<string, string | Response | Error>) {
  const window = new Window({
    url: "https://capture.example.com/",
    settings: { disableCSSFileLoading: true, disableJavaScriptEvaluation: true },
  });
  window.document.head.innerHTML = head;
  window.document.body.innerHTML = '<div class="hero"></div><div class="footer"></div>';
  const fetch = vi.mocked(publicRequest).mockImplementation(async (url) => {
    const sheet = sheets[String(url)];
    if (sheet === undefined) throw new Error(`Unexpected stylesheet request: ${url}`);
    if (sheet instanceof Error) throw sheet;
    return typeof sheet === "string" ? new Response(sheet) : sheet;
  });
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
        requests: fetch.mock.calls.map(([url]) => String(url)),
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

describe("extractHtml", () => {
  it("keeps a font the page declares in its own <style> with a relative url", async () => {
    const window = new Window({ url: "https://brand.example/pricing/" });
    window.document.head.innerHTML =
      '<style>@font-face{font-family:"Display";src:url("/fonts/Display-Medium.woff2") format("woff2")}' +
      ".glow{filter:url(#glow)}</style>";
    const dir = mkdtempSync(join(tmpdir(), "hf-inline-font-"));
    try {
      const extracted = await extractHtml(fakePage(window), { settleTime: 0 });
      expect(extracted.headHtml).toContain("url(#glow)");

      const fetched: string[] = [];
      vi.mocked(publicRequest).mockImplementation(async (url) => {
        fetched.push(String(url));
        return new Response(new Uint8Array(FONT));
      });
      const fonts = await downloadAndRewriteFonts(extracted.headHtml, dir);
      expect(fetched).toEqual(["https://brand.example/fonts/Display-Medium.woff2"]);
      expect(fonts.css).toContain("assets/fonts/Display-Medium.woff2");
      expect(readFileSync(join(dir, "assets/fonts/Display-Medium.woff2"))).toEqual(FONT);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await window.happyDOM.close();
    }
  });
});

it("stops inlining images when a CDN never answers and says how many kept their URLs", async () => {
  const img = (n: number) => ({
    src: `https://cdn.example/${n}.png`,
    naturalWidth: 100,
    naturalHeight: 100,
    setAttribute: () => {},
    removeAttribute: () => {},
  });
  const sameOrigin = { ...img(4), src: "https://brand.example/4.png" };
  const tiny = { ...img(5), naturalWidth: 4 };
  const imgs = [img(1), sameOrigin, img(2), tiny, img(3)];
  // A fetch that only ends when its abort signal fires, like a CDN that holds the socket open.
  const hungFetch = (_url: string, init: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
  const context = {
    Date,
    URL,
    AbortSignal,
    fetch: hungFetch,
    location: { origin: "https://brand.example" },
    document: {
      querySelectorAll: (selector: string) => (selector === "img" ? imgs : []),
      createElement: () => ({
        getContext: () => ({
          drawImage: () => {
            throw new Error("tainted canvas");
          },
        }),
      }),
    },
  };
  const page = {
    evaluate: async (script: string) => {
      if (script.includes("naturalWidth")) return runInNewContext(script, context);
      if (script.includes('link[rel="stylesheet"][href]')) return [];
      return { headHtml: "", bodyHtml: "", cssomRules: "", htmlAttrs: "", fullPageHeight: 0 };
    },
    url: () => "https://brand.example/",
  } as unknown as Page;
  const warnings: string[] = [];
  await extractHtml(page, {
    settleTime: 0,
    inlineBudgetMs: 100,
    onWarning: (message) => warnings.push(message),
  });
  // The one cut off mid-fetch and the two after it; never the same-origin or tiny ones it would not inline.
  expect(warnings).toEqual(["3 image(s) kept their original URLs: inlining stopped after 100ms"]);
}, 10_000);

it("fetches Node stylesheets through validated redirects and refuses metadata redirects", async () => {
  const window = new Window({ url: "https://brand.example/" });
  window.document.head.innerHTML =
    '<link rel="stylesheet" href="https://cdn.example/start.css">' +
    '<link rel="stylesheet" href="https://cdn.example/private.css">';
  const canceled = vi.fn();
  vi.mocked(publicRequest).mockImplementation(async (url) => {
    if (String(url).endsWith("start.css"))
      return new Response(null, {
        status: 302,
        headers: { location: "https://styles.example/final.css" },
      });
    if (String(url).endsWith("private.css"))
      return new Response(new ReadableStream({ cancel: canceled }), {
        status: 302,
        headers: { location: "http://169.254.169.254/metadata" },
      });
    if (String(url) === "https://styles.example/final.css")
      return new Response("body{color:purple}");
    throw new Error(`Unexpected request: ${url}`);
  });
  try {
    const html = await extractHtml(fakePage(window), { settleTime: 0 });
    expect(html.headHtml).toContain("body{color:purple}");
    expect(window.document.querySelector('link[href$="start.css"]')).toBeNull();
    expect(window.document.querySelector('link[href$="private.css"]')).not.toBeNull();
    expect(vi.mocked(publicRequest).mock.calls.map(([url]) => String(url))).toEqual([
      "https://cdn.example/start.css",
      "https://styles.example/final.css",
      "https://cdn.example/private.css",
    ]);
    expect(canceled).toHaveBeenCalledOnce();
  } finally {
    await window.happyDOM.close();
  }
});
