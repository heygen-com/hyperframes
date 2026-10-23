import assert from "node:assert/strict";
import { acquireBrowser, buildChromeArgs } from "../src/services/browserManager.ts";
type Sheet = {
  title?: string;
  link?: boolean;
  disabled?: boolean;
  media?: string;
  alternate?: boolean;
  empty?: boolean;
  href?: string | false;
  type?: string;
};
const cases: Array<{ name: string; meta?: string[]; sheets: Sheet[]; metaAt?: number }> = [
  {
    name: "meta after titled before later sheet",
    meta: ["Two"],
    metaAt: 1,
    sheets: [{ title: "One" }, { title: "Two" }],
  },
  {
    name: "print preferred alternate after meta",
    meta: ["Two"],
    metaAt: 1,
    sheets: [
      { title: "One", media: "print" },
      { title: "One", alternate: true, link: true },
    ],
  },
  {
    name: "meta after untitled",
    meta: ["Two"],
    metaAt: 1,
    sheets: [{}, { title: "One" }, { title: "Two" }],
  },
  {
    name: "multiple preferred meta",
    meta: ["One", "Two"],
    sheets: [{ title: "One" }, { title: "Two" }],
  },
  { name: "untitled alternate", sheets: [{ alternate: true, link: true }, {}] },
  {
    name: "missing href preferred",
    sheets: [{ title: "One", link: true, href: false }, { title: "Two" }],
  },
  {
    name: "empty href preferred",
    sheets: [{ title: "One", link: true, href: "" }, { title: "Two" }],
  },
  {
    name: "failed fetch preferred",
    sheets: [{ title: "One", link: true, href: "data:text/css;base64,%%%" }, { title: "Two" }],
  },
  {
    name: "wrong MIME preferred",
    sheets: [{ title: "One", link: true, href: "data:text/html,not-css" }, { title: "Two" }],
  },
  {
    name: "invalid type preferred",
    sheets: [{ title: "One", link: true, type: "text/plain" }, { title: "Two" }],
  },
  {
    name: "invalid style type preferred",
    sheets: [{ title: "One", type: "text/plain" }, { title: "Two" }],
  },
  {
    name: "alternate title sets",
    sheets: [
      { title: "One", link: true },
      { title: "One", link: true, alternate: true },
      { title: "Two", link: true, alternate: true },
    ],
  },
  { name: "empty preferred sheet", sheets: [{ title: "One", empty: true }, { title: "Two" }] },
  { name: "space title", sheets: [{ title: " " }, { title: "Two" }] },
  {
    name: "late default style meta",
    meta: ["Two"],
    metaAt: 2,
    sheets: [{ title: "One" }, { title: "Two" }],
  },
  {
    name: "style title sets",
    sheets: [{ title: "One" }, { title: "Two" }, { title: "One" }, { title: "one" }, {}],
  },
  {
    name: "link title sets",
    sheets: [
      { title: "One", link: true },
      { title: "Two", link: true },
      { title: "One", link: true },
      {},
    ],
  },
  { name: "link before style", sheets: [{ title: "One", link: true }, { title: "Two" }] },
  { name: "style before link", sheets: [{ title: "One" }, { title: "Two", link: true }] },
  { name: "disabled attributes", sheets: [{ disabled: true }, { disabled: true, link: true }, {}] },
  {
    name: "print preferred",
    sheets: [{ title: "One", media: "print" }, { title: "Two" }, { title: "One" }],
  },
  {
    name: "disabled preferred",
    sheets: [{ title: "One", disabled: true, link: true }, { title: "Two" }],
  },
  { name: "default style meta", meta: ["Two"], sheets: [{ title: "One" }, { title: "Two" }, {}] },
];
const expected: Record<string, boolean[]> = {
  "meta after titled before later sheet": [true, false],
  "print preferred alternate after meta": [false, true],
  "meta after untitled": [true, false, true],
  "multiple preferred meta": [true, false],
  "untitled alternate": [false, true],
  "missing href preferred": [false, true],
  "empty href preferred": [false, true],
  "failed fetch preferred": [false, false],
  "wrong MIME preferred": [false, false],
  "invalid type preferred": [false, true],
  "invalid style type preferred": [false, true],
  "alternate title sets": [true, true, false],
  "empty preferred sheet": [false, false],
  "space title": [true, false],
  "late default style meta": [true, false],
  "style title sets": [true, false, true, false, true],
  "link title sets": [true, false, true, true],
  "link before style": [true, false],
  "style before link": [true, false],
  "disabled attributes": [true, false, true],
  "print preferred": [false, false, true],
  "disabled preferred": [false, true],
  "default style meta": [false, true, true],
};
const lease = await acquireBrowser(
  buildChromeArgs({ width: 640, height: 360 }, { disableGpu: true }),
  { enableBrowserPool: false, browserTimeout: 20000, protocolTimeout: 20000 },
);
function sheetAttributes(sheet: Sheet, i: number): string {
  return `data-activation="x${i}" ${sheet.title ? `title="${sheet.title}"` : ""} ${sheet.media ? `media="${sheet.media}"` : ""} ${sheet.disabled ? "disabled" : ""} ${sheet.type ? `type="${sheet.type}"` : ""}`;
}

function sheetTag(sheet: Sheet, i: number): string {
  const attrs = sheetAttributes(sheet, i);
  const css = sheet.empty ? "" : `:root{--activation-x${i}:active}`;
  const href =
    sheet.href === false
      ? ""
      : `href="${sheet.href ?? `data:text/css,${encodeURIComponent(css)}`}"`;
  return sheet.link
    ? `<link rel="${sheet.alternate ? "alternate stylesheet" : "stylesheet"}" ${attrs} ${href}>`
    : `<style ${attrs}>${css}</style>`;
}
try {
  for (const entry of cases) {
    const page = await lease.browser.newPage();
    await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
    try {
      const tags = entry.sheets.map(sheetTag);
      const meta = (entry.meta ?? [])
        .map((value) => `<meta http-equiv="default-style" content="${value}">`)
        .join("");
      tags.splice(entry.metaAt ?? 0, 0, meta);
      await page.setContent(
        `<!DOCTYPE html><html><head>${tags.join("")}</head><body></body></html>`,
      );
      const result = {
        name: entry.name,
        version: await lease.browser.version(),
        sheets: await page.evaluate(() =>
          Array.from(
            document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>("[data-activation]"),
          ).map((el) => ({
            tag: el.localName,
            title: el.title,
            media: el.media,
            disabledAttribute: el.hasAttribute("disabled"),
            disabled: el.disabled,
            sheetDisabled: el.sheet?.disabled ?? null,
            active:
              getComputedStyle(document.documentElement)
                .getPropertyValue(`--activation-${el.getAttribute("data-activation")}`)
                .trim() === "active",
          })),
        ),
      };
      console.log(JSON.stringify(result));
      assert.deepEqual(
        result.sheets.map((sheet) => sheet.active),
        expected[entry.name],
        entry.name,
      );
    } finally {
      await page.close();
    }
  }
} finally {
  await lease.release();
}
