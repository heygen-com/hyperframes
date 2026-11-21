import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import { MAX_EXPANDED_ELEMENTS } from "@hyperframes/core/compiler";
import { compileForRender } from "./htmlCompiler.js";
import { extractSafeRenderErrorCode } from "./safeRenderErrorCode.js";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const root = (body: string) =>
  `<!doctype html><html><head></head><body><main data-composition-id="root" data-start="0" data-duration="1" data-width="16" data-height="16">${body}</main></body></html>`;
const mount = (id: string, src: string) =>
  `<div data-composition-id="${id}" data-composition-src="${src}" data-start="0" data-duration="1"></div>`;

function compile(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "hf-late-host-ids-"));
  dirs.push(dir);
  for (const [name, html] of Object.entries(files)) writeFileSync(join(dir, name), html);
  return compileForRender(dir, join(dir, "index.html"), join(dir, "out"), {
    allowSystemFontCapture: false,
  });
}

// fails without the fix: each candidate id of a nested host rescanned the whole page.
it("finds a nested host's id in reads proportional to the page, whatever ids it already holds", async () => {
  const taken = 2000;
  const element = Object.getPrototypeOf(parseHTML("<p></p>").document.querySelector("p"));
  const owner = (function find(proto) {
    return Object.prototype.hasOwnProperty.call(proto, "getAttribute")
      ? proto
      : find(Object.getPrototypeOf(proto));
  })(element);
  const read = owner.getAttribute;
  let idReads = 0;
  vi.spyOn(owner, "getAttribute").mockImplementation(function (this: Element, name: string) {
    if (name === "data-composition-id") idReads += 1;
    return read.call(this, name);
  });
  const held = Array.from(
    { length: taken },
    (_, i) => `<i data-composition-id="card__hf${i + 1}"></i>`,
  );

  const { html } = await compile({
    "index.html": root(held.join("") + mount("outer", "outer.html")),
    "outer.html": `<template><div data-composition-id="outer" data-width="16" data-height="16">${mount("card", "card.html")}</div></template>`,
    "card.html": `<template><div data-composition-id="card" data-width="16" data-height="16"><b>card</b></div></template>`,
  });

  expect(idReads).toBeLessThan(taken * 50);
  const assigned = `card__hf${taken + 1}`;
  expect(html.split(`data-composition-id="${assigned}"`).length - 1).toBe(1);
}, 60_000);

// fails without the fix: only elements copied by mounts were counted, so the entry page's own were never bounded.
it("counts the entry page's own elements against the element cap", async () => {
  const error = await compile({
    "index.html": root("<i></i>".repeat(MAX_EXPANDED_ELEMENTS)),
  }).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
  expect(error).toMatchObject({
    publicMetadata: { limitElements: MAX_EXPANDED_ELEMENTS, exceeded: "elements" },
  });
}, 60_000);
