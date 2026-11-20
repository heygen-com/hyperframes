import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { compileForRender } from "./htmlCompiler.js";

const fontReads = vi.hoisted(() => [] as string[]);
vi.mock("fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("fs")>();
  return {
    ...fs,
    createReadStream: ((path: string, ...rest: unknown[]) => {
      if (String(path).endsWith(".woff2")) fontReads.push(String(path));
      return (fs.createReadStream as (...args: unknown[]) => unknown)(path, ...rest);
    }) as typeof fs.createReadStream,
  };
});

const dirs: string[] = [];
afterEach(() => {
  fontReads.length = 0;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// fails without the fix: every font was read and kept as a data URI before the budget was checked.
it("reads only the fonts whose data URIs fit the page's inline budget", async () => {
  const fonts = 14;
  const dir = mkdtempSync(join(tmpdir(), "hf-font-reserve-"));
  dirs.push(dir);
  mkdirSync(join(dir, "fonts"));
  const font = Buffer.alloc(4 * 1024 * 1024, 7);
  const faces = Array.from({ length: fonts }, (_, i) => {
    writeFileSync(join(dir, "fonts", `f${i}.woff2`), font);
    return `@font-face { font-family: F${i}; src: url(fonts/f${i}.woff2); } .f${i} { font-family: F${i}; }`;
  }).join("\n");
  const text = Array.from({ length: fonts }, (_, i) => `<p class="f${i}">text</p>`).join("");
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><head><style>${faces}</style></head><body><main data-composition-id="root" data-start="0" data-duration="1" data-width="16" data-height="16">${text}</main></body></html>`,
  );

  const { html } = await compileForRender(dir, join(dir, "index.html"), join(dir, "out"), {
    allowSystemFontCapture: false,
  });

  const embedded = html.split("data:font/").length - 1;
  expect(embedded).toBeGreaterThan(0);
  expect(embedded).toBeLessThan(fonts);
  expect(fontReads).toHaveLength(embedded);
}, 30_000);
