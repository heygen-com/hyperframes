import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { prepareProjectDir } from "./generate-catalog-previews.js";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";

const repoRoot = resolve(import.meta.dirname, "..");
const previewPath = resolve(repoRoot, "docs/images/catalog/blocks/thread-message-stack.png");

after(() => rmSync(previewPath, { force: true }));

describe("catalog preview raw block boundary", () => {
  it("renders thread-message-stack through the exact Catalog Previews command", () => {
    rmSync(previewPath, { force: true });
    const result = spawnSync(
      "bunx",
      [
        "tsx",
        "scripts/generate-catalog-previews.ts",
        "--only",
        "thread-message-stack",
        "--skip-video",
      ],
      { cwd: repoRoot, encoding: "utf8", timeout: 120_000 },
    );
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 0, output);
    assert.ok(!output.includes("✗ thread-message-stack"), output);
    assert.ok(!output.includes("[Browser:ERROR]"), output);
    assert.ok(!output.includes("timelines not registered"), output);
    assert.ok(!output.includes("sub_timeline_readiness_timeout"), output);
    assert.ok(output.includes("✓ thread-message-stack.png"), output);
    assert.ok(existsSync(previewPath), previewPath);
  });
});

async function preparedHtml(sourceDir: string, entryFile: string): Promise<string> {
  const projectDir = await prepareProjectDir(
    { name: "duration-test", kind: "component", sourceDir, entryFile },
    { compile: false, hostedAssets: "cdn", uiFragment: true },
  );
  try {
    return readFileSync(join(projectDir, "index.html"), "utf8");
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

describe("catalog wrapper duration", () => {
  it("cleans its temporary project when reading the authored entry fails", async () => {
    const name = `duration-error-${process.pid}`;
    const sourceDir = mkdtempSync(join(tmpdir(), "catalog-duration-source-"));
    const projects = () =>
      readdirSync(tmpdir()).filter((entry) => entry.startsWith(`hf-catalog-${name}-`));
    const before = projects();
    try {
      await assert.rejects(
        prepareProjectDir(
          { name, kind: "component", sourceDir, entryFile: "missing.html" },
          { compile: false, hostedAssets: "cdn" },
        ),
        { code: "ENOENT" },
      );
      assert.deepEqual(projects(), before);
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
      for (const project of projects())
        if (!before.includes(project))
          rmSync(join(tmpdir(), project), { recursive: true, force: true });
    }
  });
  it("uses Count Up's authored three seconds for the wrapper and mounted snippet", async () => {
    const html = await preparedHtml(
      join(repoRoot, "registry/components/count-up"),
      "count-up.html",
    );
    assert.deepEqual(
      [...html.matchAll(/data-duration="([^"]+)"/g)].map((m) => m[1]),
      ["3", "3"],
    );
  });

  it("lets Touch Indicator's registered timeline determine its preview length", async () => {
    const html = await preparedHtml(
      join(repoRoot, "registry/components/touch-indicator"),
      "touch-indicator.html",
    );
    assert.ok(!html.includes("data-duration="));
  });

  for (const fixture of [
    {
      name: "root duration before a shorter child",
      html: '<div data-composition-id="root" data-duration="2.5"><div data-duration="1"></div></div>',
      manifest: 8,
      expected: "2.5",
    },
    {
      name: "composition duration on a template",
      html: "<template data-composition-id='root' data-composition-duration='6.25'></template>",
      manifest: 2,
      expected: "6.25",
    },
    {
      name: "authored duration inside a template",
      html: '<template><div data-composition-id="root" data-duration="2.5"></div></template>',
      manifest: 8,
      expected: "2.5",
    },
    {
      name: "manifest duration when none is authored",
      html: '<div data-composition-id="root"></div>',
      manifest: 7,
      expected: "7",
    },
    {
      name: "leaves duration for the runtime when none is declared",
      html: '<div data-composition-id="root"></div>',
      expected: null,
    },
    {
      name: "invalid authored duration",
      html: '<div data-composition-id="root" data-duration="3seconds"></div>',
      manifest: 7,
      expected: "7",
    },
  ]) {
    it(fixture.name, async () => {
      const sourceDir = mkdtempSync(join(tmpdir(), "catalog-duration-"));
      try {
        writeFileSync(
          join(sourceDir, "registry-item.json"),
          JSON.stringify({ duration: fixture.manifest }),
        );
        writeFileSync(join(sourceDir, "entry.html"), fixture.html);
        const html = await preparedHtml(sourceDir, "entry.html");
        assert.deepEqual(
          [...html.matchAll(/data-duration="([^"]+)"/g)].map((m) => m[1]),
          fixture.expected === null ? [] : [fixture.expected, fixture.expected],
        );
      } finally {
        rmSync(sourceDir, { recursive: true, force: true });
      }
    });
  }
});

describe("catalog snippet wrapper theme", () => {
  it("gives Testimonial Card the tokens and canvas its demo sets", async () => {
    const html = await preparedHtml(
      join(repoRoot, "registry/components/testimonial-card"),
      "testimonial-card.html",
    );
    assert.match(html, /:root \{[^}]*--bg: #070a12;[^}]*--fg: #f8fafc;/);
    assert.match(html, /background: var\(--bg, #0a0a0a\)/);
  });

  it("takes tokens from the mount and its ancestors, nearest last", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "catalog-theme-"));
    try {
      writeFileSync(join(sourceDir, "registry-item.json"), "{}");
      writeFileSync(join(sourceDir, "entry.html"), '<div data-composition-id="entry"></div>');
      writeFileSync(
        join(sourceDir, "demo.html"),
        `<!doctype html><html><head><style>
          :root { --bg: #000; --fg: #fff; }
          #root { --bg: #111; }
          .mount { --surface: #222; width: 10px; }
          .other { --fg: #f00; }
          .mount::before { --fg: #0f0; }
        </style></head><body><div id="root">
          <div class="other" data-composition-src="./other.html"></div>
          <div class="mount" style="--border: #333" data-composition-src="./entry.html"></div>
        </div></body></html>`,
      );
      const html = await preparedHtml(sourceDir, "entry.html");
      assert.match(
        html,
        /:root \{ --bg: #000; --fg: #fff; --bg: #111; --surface: #222; --border: #333; \}/,
      );
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });
});
