import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import type { Page } from "puppeteer-core";
import { extractTokens } from "./tokenExtractor.js";

async function tokensOf(body: string) {
  const window = new Window();
  window.document.body.innerHTML = body;
  const evaluate: Page["evaluate"] = async (script, ..._args) => {
    if (typeof script !== "string") throw new Error("Expected a page expression");
    return runInNewContext(script, {
      window,
      document: window.document,
      location: window.location,
      getComputedStyle: window.getComputedStyle.bind(window),
    });
  };
  try {
    return await extractTokens({ evaluate } as Page);
  } finally {
    await window.happyDOM.close();
  }
}

describe("capture tokens", () => {
  it("keeps an inline SVG logo over 10 KB whole", async () => {
    const shapes = Array.from({ length: 3000 }, (_, i) => `<path d="M${i} 0h1v10h-1z"></path>`);
    const logo = `<svg viewBox="0 0 3000 10" width="300">${shapes.join("")}</svg>`;
    expect(logo.length).toBeGreaterThan(10_000);
    const tokens = await tokensOf(`<header class="logo"><a href="/">${logo}</a></header>`);
    expect(tokens.svgs).toHaveLength(1);
    expect(tokens.svgs[0]!.outerHTML.length).toBe(logo.length);
    expect(tokens.svgs[0]!.outerHTML.endsWith("</svg>")).toBe(true);
    expect(tokens.svgs[0]!.isLogo).toBe(true);
  });
});
