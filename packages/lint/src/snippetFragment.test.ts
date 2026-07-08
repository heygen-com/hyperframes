import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lintProject } from "./project.js";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const INDEX = `<html><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="2" data-width="640" data-height="360"></div>
<script>window.__timelines = { main: { paused: true } };</script>
</body></html>`;

async function lintWithFragment(name: string, html: string) {
  const dir = mkdtempSync(join(tmpdir(), "hf-snippet-lint-"));
  dirs.push(dir);
  writeFileSync(join(dir, "index.html"), INDEX);
  mkdirSync(join(dir, "compositions"), { recursive: true });
  writeFileSync(join(dir, "compositions", name), html);
  const result = await lintProject(dir);
  return result.results.filter((r) => r.file.includes(name.replace(".html", "")));
}

describe("snippet fragment exemption", () => {
  it("skips composition-root rules for files whose ROOT carries data-hf-snippet", async () => {
    const findings = await lintWithFragment(
      "frag.html",
      '<div id="frag" data-hf-snippet="" data-figma-id="1:1" style="width: 10px"></div>\n',
    );
    expect(findings).toHaveLength(0);
  });

  it("still lints a composition that merely CONTAINS snippet markup", async () => {
    const results = await lintWithFragment(
      "scene.html",
      '<div id="scene"><div data-hf-snippet="" data-figma-id="1:1"></div></div>\n',
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.result.findings.some((f) => f.code === "root_missing_composition_id")).toBe(
      true,
    );
  });
});
