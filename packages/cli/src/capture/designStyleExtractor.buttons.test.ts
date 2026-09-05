import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import type { Page } from "puppeteer-core";
import { extractDesignStyles } from "./designStyleExtractor.js";

async function extractButtons(body: string) {
  const window = new Window();
  window.document.body.innerHTML = body;
  for (const element of window.document.querySelectorAll("button, a")) {
    element.getBoundingClientRect = () => new window.DOMRect(0, 0, 100, 40);
  }
  const evaluate: Page["evaluate"] = async (script, ..._args) => {
    if (typeof script !== "string") throw new Error("Expected a page expression");
    return runInNewContext(script, {
      window,
      document: window.document,
      getComputedStyle: window.getComputedStyle.bind(window),
    });
  };
  try {
    return (await extractDesignStyles({ evaluate })).buttons;
  } finally {
    await window.happyDOM.close();
  }
}

describe("capture button styles", () => {
  // Chrome serializes opaque modern rgb() to rgb(r, g, b), and zero alpha to rgba().
  it.each([
    ["rgb(0, 0, 0)", "#000000"],
    ["rgb(255, 180, 0)", "#FFB400"],
  ])("retains an opaque navigation CTA with %s", async (color, background) => {
    const buttons = await extractButtons(
      `<nav><a class="btn" style="background-color: ${color}">Start</a></nav>`,
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toMatchObject({ label: "Start", background });
  });

  it("excludes a transparent navigation link", async () => {
    const buttons = await extractButtons(
      '<nav><a class="btn" style="background-color: rgba(0, 0, 0, 0)">Docs</a></nav>',
    );
    expect(buttons).toEqual([]);
  });

  it("retains a gradient navigation CTA with a transparent background color", async () => {
    const buttons = await extractButtons(
      '<nav><a class="btn" style="background-color: rgba(0, 0, 0, 0); background-image: linear-gradient(red, blue)">Start</a></nav>',
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toMatchObject({ label: "Start", background: "transparent" });
    expect(buttons[0]?.backgroundImage).toContain("linear-gradient");
  });

  it("keeps glass and plain variants distinct while deduplicating identical glass buttons", async () => {
    const buttons = await extractButtons(`
      <button style="background-color: rgba(255, 255, 255, 0.5)">Plain</button>
      <button style="background-color: rgba(255, 255, 255, 0.5); backdrop-filter: blur(12px)">Glass</button>
      <button style="background-color: rgba(255, 255, 255, 0.5); backdrop-filter: blur(12px)">Glass copy</button>
    `);
    expect(buttons.map(({ label, backdropFilter }) => ({ label, backdropFilter }))).toEqual([
      { label: "Plain", backdropFilter: "" },
      { label: "Glass", backdropFilter: "blur(12px)" },
    ]);
  });
});
