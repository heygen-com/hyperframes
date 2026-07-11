import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { HyperframeLintFinding } from "./types.js";
import { lintProject } from "./project.js";

function tmpProject(name: string): string {
  return mkdtempSync(join(tmpdir(), `hf-lint-test-${name}-`));
}

function validHtml(compId = "main"): string {
  return `<html><body>
  <div data-composition-id="${compId}" data-width="1920" data-height="1080" data-start="0" data-duration="10"></div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["${compId}"] = gsap.timeline({ paused: true });</script>
</body></html>`;
}

let dirs: string[] = [];

function makeProject(indexHtml: string, subComps?: Record<string, string>): string {
  const dir = tmpProject("lint");
  dirs.push(dir);
  writeFileSync(join(dir, "index.html"), indexHtml);
  if (subComps) {
    const compsDir = join(dir, "compositions");
    mkdirSync(compsDir, { recursive: true });
    for (const [name, html] of Object.entries(subComps)) {
      writeFileSync(join(compsDir, name), html);
    }
  }
  return dir;
}

afterEach(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
  dirs = [];
});

describe("missing_or_empty_sub_composition", () => {
  function htmlWithSubComp(srcPath: string): string {
    return `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10">
    <div data-composition-src="${srcPath}" data-composition-id="scene-title" data-start="0" data-duration="5"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
  }

  function validSubCompHtml(): string {
    return `<!doctype html><html><body>
  <div data-composition-id="scene-title" data-width="1920" data-height="1080">
    <div class="title">Hello</div>
  </div>
</body></html>`;
  }

  // Shared assertion: lint a project referencing "compositions/scene-title.html"
  // (or a custom srcPath) and return the missing_or_empty_sub_composition
  // finding, if any, plus the raw lint result for callers that need totalErrors.
  async function lintSubComp(
    srcPath: string,
    subCompFiles?: Record<string, string>,
  ): Promise<{ finding: HyperframeLintFinding | undefined; totalErrors: number }> {
    const project = makeProject(htmlWithSubComp(srcPath), subCompFiles);
    const { totalErrors, results } = await lintProject(project);
    const finding = results
      .flatMap((r) => r.result.findings)
      .find((f) => f.code === "missing_or_empty_sub_composition");
    return { finding, totalErrors };
  }

  it.each([
    {
      label: "empty",
      content: "",
      expectMessageContains: "empty",
    },
    {
      label: "whitespace-only",
      content: "   \n\t  ",
      expectMessageContains: "empty",
    },
    {
      label: "malformed / non-HTML",
      content: "just some plain text, no tags at all",
      expectMessageContains: "could not be parsed",
    },
  ])(
    "errors when the referenced sub-composition file is $label",
    async ({ content, expectMessageContains }) => {
      const { finding, totalErrors } = await lintSubComp("compositions/scene-title.html", {
        "scene-title.html": content,
      });

      expect(totalErrors).toBeGreaterThan(0);
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain(expectMessageContains);
    },
  );

  it("errors when the referenced sub-composition file does not exist", async () => {
    // No subComps passed — compositions/ directory doesn't even exist.
    const { finding, totalErrors } = await lintSubComp("compositions/does-not-exist.html");

    expect(totalErrors).toBeGreaterThan(0);
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("compositions/does-not-exist.html");
    expect(finding?.message).toContain("does not exist");
  });

  it("errors when the referenced sub-composition file has content but no data-composition-id root", async () => {
    const { finding, totalErrors } = await lintSubComp("compositions/scene-title.html", {
      "scene-title.html": "<!doctype html><html><body><p>TODO: scene content</p></body></html>",
    });

    expect(totalErrors).toBeGreaterThan(0);
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("data-composition-id");
  });

  it("does not error when the referenced sub-composition file is valid (happy path)", async () => {
    const { finding } = await lintSubComp("compositions/scene-title.html", {
      "scene-title.html": validSubCompHtml(),
    });
    expect(finding).toBeUndefined();
  });

  it("does not error on a project with no data-composition-src references", async () => {
    const project = makeProject(validHtml());
    const { results } = await lintProject(project);
    const finding = results
      .flatMap((r) => r.result.findings)
      .find((f) => f.code === "missing_or_empty_sub_composition");
    expect(finding).toBeUndefined();
  });

  it("dedupes a single bad reference into one finding even if repeated", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10">
    <div data-composition-src="compositions/scene-title.html" data-composition-id="a" data-start="0" data-duration="5"></div>
    <div data-composition-src="compositions/scene-title.html" data-composition-id="b" data-start="5" data-duration="5"></div>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html, { "scene-title.html": "" });

    const { results } = await lintProject(project);

    const findings = results
      .flatMap((r) => r.result.findings)
      .filter((f) => f.code === "missing_or_empty_sub_composition");
    expect(findings).toHaveLength(1);
  });

  // Regression: lint used to raw-filesystem-walk every .html under
  // compositions/, regardless of whether the root composition actually
  // references it. render's pre-flight (assertSubCompositionsUsable) only
  // follows real data-composition-src references starting from the root, so
  // an orphaned file with its own dangling reference made `lint`/`validate`
  // fail even though `render` succeeds fine on the same project.
  it("does not error on an orphaned, unreferenced file under compositions/ with a dangling reference inside it", async () => {
    const project = makeProject(validHtml(), {});
    const archivedDir = join(project, "compositions", "archived");
    mkdirSync(archivedDir, { recursive: true });
    // Never referenced from index.html — this file is unreachable.
    writeFileSync(
      join(archivedDir, "old-draft.html"),
      `<!doctype html><html><body>
  <div data-composition-id="old-draft" data-width="1920" data-height="1080">
    <div data-composition-src="compositions/does-not-exist.html" data-composition-id="ghost"></div>
  </div>
</body></html>`,
    );

    const { results, totalErrors } = await lintProject(project);
    const finding = results
      .flatMap((r) => r.result.findings)
      .find((f) => f.code === "missing_or_empty_sub_composition");

    expect(finding).toBeUndefined();
    expect(totalErrors).toBe(0);
  });

  it("still errors when a broken reference IS reachable from the root (nested, not just top-level)", async () => {
    const project = makeProject(htmlWithSubComp("compositions/parent.html"));
    mkdirSync(join(project, "compositions"), { recursive: true });
    writeFileSync(
      join(project, "compositions", "parent.html"),
      `<!doctype html><html><body>
  <div data-composition-id="scene-title" data-width="1920" data-height="1080">
    <div data-composition-src="compositions/does-not-exist.html" data-composition-id="child"></div>
  </div>
</body></html>`,
    );

    const { results, totalErrors } = await lintProject(project);
    const finding = results
      .flatMap((r) => r.result.findings)
      .find((f) => f.code === "missing_or_empty_sub_composition");

    expect(totalErrors).toBeGreaterThan(0);
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("compositions/does-not-exist.html");
  });
});

describe("template shell style sources", () => {
  it("collects links, style blocks, and inline styles from template content", async () => {
    const project = makeProject(`<html><body>
      <div id="scene" data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10"></div>
      <template data-composition-id="shell">
        <link rel="stylesheet" href="shell.css">
        <style>[data-composition-id="main"] .title { opacity: 0; }</style>
        <div style="mask-image: url(missing-inline-mask.png)"></div>
        <template><style>[data-composition-id="main"] .nested { opacity: 0; }</style></template>
      </template>
      <script>window.__timelines = {};</script>
    </body></html>`);
    writeFileSync(
      join(project, "shell.css"),
      '[data-composition-id="main"] .from-link { opacity: 0; }',
    );

    const { results } = await lintProject(project);
    const findings = results.flatMap((entry) => entry.result.findings);
    expect(
      findings.filter((finding) => finding.code === "composition_self_attribute_selector"),
    ).toHaveLength(3);
    expect(findings.some((finding) => finding.code === "texture_mask_asset_not_found")).toBe(true);
  });
});
