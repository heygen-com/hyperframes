import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegistryItem, RegistryManifest } from "@hyperframes/core";
import { AddError, buildSnippet, remapTarget, runAdd } from "./add.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const MANIFEST: RegistryManifest = {
  $schema: "https://hyperframes.heygen.com/schema/registry.json",
  name: "test",
  homepage: "https://example.com",
  items: [
    { name: "my-block", type: "hyperframes:block" },
    { name: "my-component", type: "hyperframes:component" },
    { name: "my-example", type: "hyperframes:example" },
  ],
};

const BLOCK_ITEM: RegistryItem = {
  $schema: "https://hyperframes.heygen.com/schema/registry-item.json",
  name: "my-block",
  type: "hyperframes:block",
  title: "My Block",
  description: "Block for tests",
  dimensions: { width: 1080, height: 1350 },
  duration: 6,
  files: [
    {
      path: "my-block.html",
      target: "compositions/my-block.html",
      type: "hyperframes:composition",
    },
  ],
};

const COMPONENT_ITEM: RegistryItem = {
  $schema: "https://hyperframes.heygen.com/schema/registry-item.json",
  name: "my-component",
  type: "hyperframes:component",
  title: "My Component",
  description: "Component for tests",
  files: [
    {
      path: "my-component.html",
      target: "compositions/components/my-component/my-component.html",
      type: "hyperframes:snippet",
    },
    {
      path: "my-component.css",
      target: "compositions/components/my-component/my-component.css",
      type: "hyperframes:style",
    },
  ],
};

const EXAMPLE_ITEM: RegistryItem = {
  $schema: "https://hyperframes.heygen.com/schema/registry-item.json",
  name: "my-example",
  type: "hyperframes:example",
  title: "My Example",
  description: "Example for tests",
  dimensions: { width: 1920, height: 1080 },
  duration: 10,
  files: [{ path: "index.html", target: "index.html", type: "hyperframes:composition" }],
};

const ITEM_BY_NAME: Record<string, RegistryItem> = {
  "my-block": BLOCK_ITEM,
  "my-component": COMPONENT_ITEM,
  "my-example": EXAMPLE_ITEM,
};

function mockFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/registry.json")) {
        return new Response(JSON.stringify(MANIFEST), { status: 200 });
      }
      const m = /\/(examples|blocks|components)\/([^/]+)\/registry-item\.json$/.exec(url);
      if (m) {
        const item = ITEM_BY_NAME[m[2]!];
        if (item) return new Response(JSON.stringify(item), { status: 200 });
      }
      // File fetch — match `/<type-dir>/<name>/<rest>` and serve synthetic content.
      const f = /\/(examples|blocks|components)\/([^/]+)\/(.+)$/.exec(url);
      if (f) {
        return new Response(`/* ${f[3]} */\n`, { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "hf-add-test-"));
}

function uniqueBase(): string {
  return `https://test.invalid/${crypto.randomUUID()}`;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("add command pure helpers", () => {
  describe("remapTarget", () => {
    const PATHS = { blocks: "src/scenes", components: "src/fx" };

    it("rewrites block default path to paths.blocks", () => {
      expect(remapTarget(BLOCK_ITEM, "compositions/my-block.html", PATHS)).toBe(
        "src/scenes/my-block.html",
      );
    });

    it("rewrites component default path to paths.components", () => {
      expect(
        remapTarget(
          COMPONENT_ITEM,
          "compositions/components/my-component/my-component.html",
          PATHS,
        ),
      ).toBe("src/fx/my-component/my-component.html");
    });

    it("leaves example targets alone", () => {
      expect(remapTarget(EXAMPLE_ITEM, "index.html", PATHS)).toBe("index.html");
    });

    it("leaves non-default block paths alone (no blind string replace)", () => {
      // A block's manifest could in future use a non-default target — make
      // sure the prefix match is anchored.
      expect(remapTarget(BLOCK_ITEM, "elsewhere/my-block.html", PATHS)).toBe(
        "elsewhere/my-block.html",
      );
    });
  });

  describe("buildSnippet", () => {
    it("wraps blocks in an iframe with start/duration", () => {
      const snip = buildSnippet(BLOCK_ITEM, "src/scenes/my-block.html");
      expect(snip).toContain('src="src/scenes/my-block.html"');
      expect(snip).toContain('data-duration="6"');
    });

    it("emits a paste hint for components", () => {
      const snip = buildSnippet(COMPONENT_ITEM, "src/fx/my-component/my-component.html");
      expect(snip).toContain("paste from");
      expect(snip).toContain("my-component.html");
    });

    it("returns empty string for examples", () => {
      expect(buildSnippet(EXAMPLE_ITEM, "index.html")).toBe("");
    });
  });
});

describe("runAdd (integration, mocked registry)", () => {
  beforeEach(() => mockFetch());
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("installs a block into the default compositions/ path and returns the snippet", async () => {
    const dir = tmp();
    try {
      // Write hyperframes.json so runAdd uses our unique baseUrl.
      const baseUrl = uniqueBase();
      const cfg = {
        $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
        registry: baseUrl,
        paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
      };
      writeFileSync(join(dir, "hyperframes.json"), JSON.stringify(cfg), "utf-8");

      const result = await runAdd({ name: "my-block", projectDir: dir, skipClipboard: true });
      expect(result.ok).toBe(true);
      expect(result.name).toBe("my-block");
      expect(result.type).toBe("hyperframes:block");
      expect(result.written).toHaveLength(1);
      expect(existsSync(join(dir, "compositions/my-block.html"))).toBe(true);
      expect(readFileSync(join(dir, "compositions/my-block.html"), "utf-8")).toContain(
        "my-block.html",
      );
      expect(result.snippet).toContain("compositions/my-block.html");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("remaps component targets per hyperframes.json paths.components", async () => {
    const dir = tmp();
    try {
      const baseUrl = uniqueBase();
      const cfg = {
        $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
        registry: baseUrl,
        paths: { blocks: "compositions", components: "src/fx", assets: "assets" },
      };
      writeFileSync(join(dir, "hyperframes.json"), JSON.stringify(cfg), "utf-8");

      const result = await runAdd({
        name: "my-component",
        projectDir: dir,
        skipClipboard: true,
      });
      expect(result.written.length).toBe(2);
      expect(existsSync(join(dir, "src/fx/my-component/my-component.html"))).toBe(true);
      expect(existsSync(join(dir, "src/fx/my-component/my-component.css"))).toBe(true);
      expect(result.snippet).toContain("src/fx/my-component/my-component.html");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws AddError with code 'example-type' when asked to add an example", async () => {
    const dir = tmp();
    try {
      const baseUrl = uniqueBase();
      writeFileSync(
        join(dir, "hyperframes.json"),
        JSON.stringify({
          registry: baseUrl,
          paths: {
            blocks: "compositions",
            components: "compositions/components",
            assets: "assets",
          },
        }),
        "utf-8",
      );

      await expect(
        runAdd({ name: "my-example", projectDir: dir, skipClipboard: true }),
      ).rejects.toMatchObject({
        code: "example-type",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws AddError with code 'unknown-item' for a missing name", async () => {
    const dir = tmp();
    try {
      const baseUrl = uniqueBase();
      writeFileSync(
        join(dir, "hyperframes.json"),
        JSON.stringify({
          registry: baseUrl,
          paths: {
            blocks: "compositions",
            components: "compositions/components",
            assets: "assets",
          },
        }),
        "utf-8",
      );

      await expect(
        runAdd({ name: "nope", projectDir: dir, skipClipboard: true }),
      ).rejects.toBeInstanceOf(AddError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
