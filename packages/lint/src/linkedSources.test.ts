// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintHyperframeHtml } from "./hyperframeLinter";
import { linkedSources } from "./project";
import { MAX_EXPANDED_COMPOSITION_BYTES } from "./sizeLimits";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

function project(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hf-linked-sources-")));
  dirs.push(root);
  for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);
  return root;
}

const page = (head: string, body = "") => `<!doctype html><html><head>${head}</head><body>
<div data-composition-id="main" data-width="320" data-height="180" data-start="0" data-duration="2"></div>
${body}</body></html>`;
const links = (names: string[]) => names.map((n) => `<link rel="stylesheet" href="${n}">`).join("");

describe("linkedSources", () => {
  it("reads a stylesheet linked by many tags once", () => {
    const html = page(links(Array(70).fill("a.css")));
    const dir = project({ "index.html": html, "a.css": ".a{color:red}" });

    expect(linkedSources(dir, html).externalStyles).toHaveLength(1);
  });

  it("reads a file once under all of its symlink names", () => {
    const names = Array.from({ length: 5 }, (_, i) => `alias-${i}.css`);
    const html = page(links(["a.css", ...names]));
    const dir = project({ "index.html": html, "a.css": ".a{color:red}" });
    for (const name of names) symlinkSync(join(dir, "a.css"), join(dir, name));

    expect(linkedSources(dir, html).externalStyles).toHaveLength(1);
  });

  it("leaves out a linked file that would take the reads past one bundle's size limit, and warns once", async () => {
    const small = ".a{color:red}";
    const html = page(links(["a.css", "b.css", "c.css"]));
    const dir = project({
      "index.html": html,
      "a.css": small,
      "b.css": `/*${"x".repeat(MAX_EXPANDED_COMPOSITION_BYTES - small.length - 3)}*/`,
      "c.css": ".c{color:blue}",
    });

    const sources = linkedSources(dir, html);
    const { findings } = await lintHyperframeHtml(html, sources);

    expect(sources.externalStyles?.map((style) => style.href)).toEqual(["a.css", "c.css"]);
    expect(sources.linkedFilesOverLimit).toEqual([{ href: "b.css", kind: "stylesheet" }]);
    expect(findings.filter((f) => f.code === "linked_files_not_checked")).toEqual([
      expect.objectContaining({ severity: "warning" }),
    ]);
  }, 60_000);

  it.each([
    ["script", false],
    ["stylesheet", true],
  ] as const)(
    "with a %s left unread, reports a missing timeline registry: %s",
    async (kind, reported) => {
      const { findings } = await lintHyperframeHtml(page(""), {
        linkedFilesOverLimit: [{ href: "big.file", kind }],
      });

      expect(findings.some((f) => f.code === "missing_timeline_registry")).toBe(reported);
    },
  );
});
