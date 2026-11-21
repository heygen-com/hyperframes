import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { runCommand as runCittyCommand, type CommandDef } from "citty";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegistryItem, RegistryManifest } from "@hyperframes/core";
import { lintHyperframeHtml } from "@hyperframes/lint";
import type { RunAddResult } from "./add.js";
import addCommand, {
  AddError,
  buildSnippet,
  compositionRootId,
  describeInstallFailure,
  parseVariableValues,
  remapTarget,
  runAdd,
  tagAddJson,
} from "./add.js";
import { DEFAULT_REGISTRY_URL } from "../registry/index.js";
import { stagePublishFiles } from "../utils/publishProject.js";
import { trackRegistryItemAdded } from "../telemetry/events.js";
import { trackCommandFailures } from "../utils/command-failure-tracking.js";

// Assert the emitted payload rather than the transport: `shouldTrack()` is
// already false under test (dev mode / no PostHog key), so a real call would
// be indistinguishable from no call at all.
vi.mock("../telemetry/events.js", () => ({ trackRegistryItemAdded: vi.fn() }));

// A write that fails on every platform: publishing the file whose target ends with `failing` throws.
const failingWrite = vi.hoisted(() => ({ failing: null as string | null }));
vi.mock("../registry/publication.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../registry/publication.js")>();
  return {
    ...actual,
    publishRegistryFile: (...args: Parameters<typeof actual.publishRegistryFile>) => {
      if (failingWrite.failing && args[1].endsWith(failingWrite.failing))
        throw new Error(`could not write ${args[1]}`);
      return actual.publishRegistryFile(...args);
    },
  };
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const MANIFEST: RegistryManifest = {
  $schema: "https://hyperframes.heygen.com/schema/registry.json",
  name: "test",
  homepage: "https://example.com",
  items: [
    { name: "my-block", type: "hyperframes:block" },
    { name: "deprecated-block", type: "hyperframes:block" },
    { name: "future-block", type: "hyperframes:block" },
    { name: "dep-block", type: "hyperframes:block" },
    { name: "base-component", type: "hyperframes:component" },
    { name: "my-component", type: "hyperframes:component" },
    { name: "my-example", type: "hyperframes:example" },
    { name: "example-dep-block", type: "hyperframes:block" },
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
    {
      path: "assets/mask.png",
      target: "assets/my-component/mask.png",
      type: "hyperframes:asset",
    },
  ],
};

const DEPRECATED_BLOCK_ITEM: RegistryItem = {
  ...BLOCK_ITEM,
  name: "deprecated-block",
  title: "Deprecated Block",
  deprecated: "Use `my-block` instead.",
  files: [
    {
      path: "deprecated-block.html",
      target: "compositions/deprecated-block.html",
      type: "hyperframes:composition",
    },
  ],
};

const FUTURE_BLOCK_ITEM: RegistryItem = {
  ...BLOCK_ITEM,
  name: "future-block",
  title: "Future Block",
  minCliVersion: "999.0.0",
  files: [
    {
      path: "future-block.html",
      target: "compositions/future-block.html",
      type: "hyperframes:composition",
    },
  ],
};

const BASE_COMPONENT_ITEM: RegistryItem = {
  $schema: "https://hyperframes.heygen.com/schema/registry-item.json",
  name: "base-component",
  type: "hyperframes:component",
  title: "Base Component",
  description: "Base component dependency for tests",
  files: [
    {
      path: "base-component.css",
      target: "compositions/components/base-component/base-component.css",
      type: "hyperframes:style",
    },
  ],
};

// A block that declares a transitive registryDependency on base-component.
const DEP_BLOCK_ITEM: RegistryItem = {
  ...BLOCK_ITEM,
  name: "dep-block",
  title: "Dependent Block",
  registryDependencies: ["base-component"],
  files: [
    {
      path: "dep-block.html",
      target: "compositions/dep-block.html",
      type: "hyperframes:composition",
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

const EXAMPLE_DEP_BLOCK_ITEM: RegistryItem = {
  ...BLOCK_ITEM,
  name: "example-dep-block",
  registryDependencies: ["my-example"],
};

const ITEM_BY_NAME: Record<string, RegistryItem> = {
  "example-dep-block": EXAMPLE_DEP_BLOCK_ITEM,
  "my-block": BLOCK_ITEM,
  "deprecated-block": DEPRECATED_BLOCK_ITEM,
  "future-block": FUTURE_BLOCK_ITEM,
  "dep-block": DEP_BLOCK_ITEM,
  "base-component": BASE_COMPONENT_ITEM,
  "my-component": COMPONENT_ITEM,
  "my-example": EXAMPLE_ITEM,
};

const DEP_BLOCK_HTML = `<div data-composition-variables='[{ "id": "maths", "type": "boolean", "label": "Maths", "default": false }]'></div>`;

const FILE_BODIES: Record<string, string> = {
  "dep-block.html": DEP_BLOCK_HTML,
  "deprecated-block.html": `<div data-composition-id="deprecated-block"></div>`,
  "my-block.html": `<div data-composition-id="my-block-root" data-width="1080" data-height="1350"></div>`,
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
        return new Response(FILE_BODIES[f[3]!] ?? `/* ${f[3]} */\n`, { status: 200 });
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

const DEFAULT_TEST_PATHS = {
  blocks: "compositions",
  components: "compositions/components",
  assets: "assets",
};

function writeRegistryConfig(
  dir: string,
  paths: typeof DEFAULT_TEST_PATHS = DEFAULT_TEST_PATHS,
): void {
  writeFileSync(
    join(dir, "hyperframes.json"),
    JSON.stringify({
      $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
      registry: uniqueBase(),
      paths,
    }),
    "utf-8",
  );
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
    it("wraps blocks in a div with data-composition-src and duration", () => {
      const snip = buildSnippet(BLOCK_ITEM, "src/scenes/my-block.html");
      expect(snip).toContain('data-composition-src="src/scenes/my-block.html"');
      expect(snip).toContain('data-duration="6"');
    });

    it("reads a composition's root id, inside its <template> when it has one", () => {
      expect(compositionRootId(`<div data-composition-id="plain" data-width="1"></div>`)).toBe(
        "plain",
      );
      expect(
        compositionRootId(
          `<html><head><template id="t"><div data-composition-id="templated"></div></template></head><body></body></html>`,
        ),
      ).toBe("templated");
      expect(compositionRootId(`<div>no root</div>`)).toBeUndefined();
    });

    // fails without the fix: an SVG element named template came first and has no content.
    it("reads the root inside the HTML template after an SVG element named template", () => {
      expect(
        compositionRootId(
          `<svg><template></template></svg><template id="t"><div data-composition-id="templated"></div></template>`,
        ),
      ).toBe("templated");
    });

    it("gives the block host the composition id that check requires", async () => {
      const snip = buildSnippet(BLOCK_ITEM, "compositions/my-block.html", null, "my-block-root");
      const html = `<!doctype html><html><body><div data-composition-id="root" data-width="1080" data-height="1350">${snip}</div></body></html>`;
      const { findings } = await lintHyperframeHtml(html);
      expect(findings.map((f) => f.code)).not.toContain("host_missing_composition_id");
      expect(snip).toContain('data-composition-id="my-block-root"');
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
  beforeEach(() => {
    vi.mocked(trackRegistryItemAdded).mockClear();
    mockFetch();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("installs a block into the default compositions/ path and returns the snippet", async () => {
    const dir = tmp();
    try {
      // Write hyperframes.json so runAdd uses our unique baseUrl.
      writeRegistryConfig(dir);

      const result = await runAdd({ name: "my-block", projectDir: dir, skipClipboard: true });
      expect(result.ok).toBe(true);
      expect(result.name).toBe("my-block");
      expect(result.type).toBe("hyperframes:block");
      expect(result.written).toHaveLength(1);
      expect(result.installed).toEqual(["my-block"]);
      expect(result.warnings).toEqual([]);
      expect(existsSync(join(dir, "compositions/my-block.html"))).toBe(true);
      const installed = readFileSync(join(dir, "compositions/my-block.html"), "utf-8");
      expect(installed).toContain("<!-- hyperframes-registry-item: my-block -->");
      expect(installed).toContain('data-composition-id="my-block-root"');
      expect(result.snippet).toContain("compositions/my-block.html");
      expect(result.snippet).toContain('data-composition-id="my-block-root"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns a warning for deprecated registry items while still installing", async () => {
    const dir = tmp();
    try {
      writeRegistryConfig(dir);

      const result = await runAdd({
        name: "deprecated-block",
        projectDir: dir,
        skipClipboard: true,
      });
      expect(result.warnings).toEqual([
        'Registry item "deprecated-block" is deprecated: Use `my-block` instead.',
      ]);
      expect(existsSync(join(dir, "compositions/deprecated-block.html"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blocks registry items that require a newer CLI before writing files", async () => {
    const dir = tmp();
    try {
      writeRegistryConfig(dir);

      await expect(
        runAdd({
          name: "future-block",
          projectDir: dir,
          skipClipboard: true,
          cliVersion: "0.6.79",
        }),
      ).rejects.toMatchObject({
        code: "incompatible-cli",
      });
      expect(existsSync(join(dir, "compositions/future-block.html"))).toBe(false);
      // Nothing was written, so nothing may be counted: an install count that
      // also counts refused installs is not a download count.
      expect(trackRegistryItemAdded).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("remaps component snippet/style targets while leaving asset targets stable", async () => {
    const dir = tmp();
    try {
      writeRegistryConfig(dir, { blocks: "compositions", components: "src/fx", assets: "assets" });

      const result = await runAdd({
        name: "my-component",
        projectDir: dir,
        skipClipboard: true,
      });
      expect(result.written.length).toBe(3);
      expect(existsSync(join(dir, "src/fx/my-component/my-component.html"))).toBe(true);
      expect(existsSync(join(dir, "src/fx/my-component/my-component.css"))).toBe(true);
      expect(existsSync(join(dir, "assets/my-component/mask.png"))).toBe(true);
      expect(result.snippet).toContain("src/fx/my-component/my-component.html");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a wrong-typed --vars before writing any item in the plan", async () => {
    const dir = tmp();
    try {
      writeRegistryConfig(dir);
      await expect(
        runAdd({ name: "dep-block", projectDir: dir, skipClipboard: true, vars: '{"maths":1}' }),
      ).rejects.toThrow(/maths: expected boolean, got number/);
      expect(existsSync(join(dir, "compositions/components/base-component"))).toBe(false);
      expect(existsSync(join(dir, "hyperframes.lock.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("installs transitive registryDependencies before the requested item", async () => {
    const dir = tmp();
    try {
      writeRegistryConfig(dir);

      const result = await runAdd({ name: "dep-block", projectDir: dir, skipClipboard: true });
      expect(result.name).toBe("dep-block");
      // Dependency first, requested item last.
      expect(result.installed).toEqual(["base-component", "dep-block"]);
      expect(result.written).toHaveLength(2);
      expect(
        existsSync(join(dir, "compositions/components/base-component/base-component.css")),
      ).toBe(true);
      expect(existsSync(join(dir, "compositions/dep-block.html"))).toBe(true);
      // Snippet points at the requested block, not the dependency.
      expect(result.snippet).toContain("compositions/dep-block.html");
      expect(result.warnings).toEqual([
        expect.stringContaining("compositions/dep-block.html declares no data-composition-id"),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports every installed item, marking only the requested one", async () => {
    const dir = tmp();
    try {
      writeRegistryConfig(dir);

      await runAdd({ name: "dep-block", projectDir: dir, skipClipboard: true });

      // A dependency dragged in behind the request must not read as a vote for
      // itself, or a popular dependency outranks everything that depends on it.
      expect(trackRegistryItemAdded).toHaveBeenCalledTimes(2);
      expect(trackRegistryItemAdded).toHaveBeenCalledWith({
        item: "base-component",
        itemType: "hyperframes:component",
        requested: false,
        source: "cli",
      });
      expect(trackRegistryItemAdded).toHaveBeenCalledWith({
        item: "dep-block",
        itemType: "hyperframes:block",
        requested: true,
        source: "cli",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws AddError with code 'example-type' when asked to add an example", async () => {
    const dir = tmp();
    try {
      writeRegistryConfig(dir);

      await expect(
        runAdd({ name: "my-example", projectDir: dir, skipClipboard: true }),
      ).rejects.toMatchObject({
        code: "example-type",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a block that depends on an example, before writing anything", async () => {
    const dir = tmp();
    try {
      writeRegistryConfig(dir);

      await expect(
        runAdd({ name: "example-dep-block", projectDir: dir, skipClipboard: true }),
      ).rejects.toMatchObject({ code: "example-type" });
      expect(existsSync(join(dir, "index.html"))).toBe(false);
      expect(existsSync(join(dir, "compositions"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws AddError with code 'unknown-item' for a missing name", async () => {
    const dir = tmp();
    try {
      writeRegistryConfig(dir);

      await expect(
        runAdd({ name: "nope", projectDir: dir, skipClipboard: true }),
      ).rejects.toBeInstanceOf(AddError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("variable values in the snippet", () => {
  const block = {
    name: "split-flap-board",
    type: "hyperframes:block",
    duration: 3.5,
    dimensions: { width: 1920, height: 1080 },
  } as unknown as RegistryItem;

  it("leaves the snippet alone when no values are passed", () => {
    const snippet = buildSnippet(block, "compositions/split-flap-board.html");
    expect(snippet).not.toContain("data-variable-values");
  });

  it("carries values tuned on the catalog page", () => {
    const snippet = buildSnippet(block, "compositions/split-flap-board.html", {
      boardText: "GATE 42",
      cellCount: 16,
    });
    expect(snippet).toContain(`data-variable-values='{"boardText":"GATE 42","cellCount":16}'`);
  });

  it("escapes a single quote rather than letting it close the attribute", () => {
    const snippet = buildSnippet(block, "x.html", { boardText: "IT'S BOARDING" });
    expect(snippet).toContain("&#39;");
    expect(snippet.match(/data-variable-values='/g)?.length).toBe(1);
  });

  it("treats an empty object as nothing to say", () => {
    expect(buildSnippet(block, "x.html", {})).not.toContain("data-variable-values");
  });

  it("rejects --vars that is not a JSON object", () => {
    expect(() => parseVariableValues("not json")).toThrow(/JSON object/);
    expect(() => parseVariableValues("[1,2]")).toThrow(/JSON object/);
    expect(parseVariableValues(undefined)).toBeNull();
  });
});

describe("add command run() — several names", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmp();
    writeRegistryConfig(dir);
    mockFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  async function runWrapped(rawArgs: string[]): Promise<void> {
    const cmd = await trackCommandFailures(() => Promise.resolve(addCommand as CommandDef))();
    await runCittyCommand(cmd, { rawArgs });
  }

  it("installs every name in one call and reports them together", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runWrapped(["my-block", "--dir", dir, "deprecated-block", "--no-clipboard", "--json"]);

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      ok: true,
      installed: ["my-block", "deprecated-block"],
      warnings: expect.any(Array),
      errors: [],
    });
    expect(existsSync(join(dir, "compositions", "my-block.html"))).toBe(true);
    expect(existsSync(join(dir, "compositions", "deprecated-block.html"))).toBe(true);
  });

  it("prints a deprecation note from the registry with control characters escaped", async () => {
    // Built rather than written: a literal control character in the source is a lint error.
    const esc = String.fromCharCode(27);
    const note = DEPRECATED_BLOCK_ITEM.deprecated;
    DEPRECATED_BLOCK_ITEM.deprecated = `gone${esc}]52;c;cA==${String.fromCharCode(7)}`;
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await runWrapped(["deprecated-block", "--dir", dir, "--no-clipboard"]);
    } finally {
      DEPRECATED_BLOCK_ITEM.deprecated = note;
    }

    const printed = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(printed.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "")).not.toContain(esc);
    expect(printed).toContain("is deprecated: gone\\x1b]52;c;cA==\\x07");
  });

  // fails without the fix: a name the registry does not have is repeated as it was typed.
  it("shows control characters in a skipped name as text", async () => {
    const esc = String.fromCharCode(27);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      runWrapped(["my-block", `no-${esc}[2Jsuch\x07`, "--dir", dir, "--no-clipboard"]),
    ).rejects.toMatchObject({ result: { exitCode: 1 } });

    const printed = log.mock.calls
      .map((call) => call.join(" "))
      .join("\n")
      .replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "");
    expect(printed).toContain("✓ my-block");
    expect(printed).toContain("✗ no-\\x1b[2Jsuch\\x07 (skipped: ");
    expect(printed).not.toContain(esc);
    expect(printed).not.toContain("\x07");
  });

  it("keeps the installs that worked when one name is unknown, and fails the call", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      runWrapped(["my-block", "no-such-block", "--dir", dir, "--no-clipboard", "--json"]),
    ).rejects.toMatchObject({ result: { exitCode: 1 } });

    const out = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(out).toMatchObject({ ok: false, installed: ["my-block"] });
    expect(out.errors).toEqual([{ name: "no-such-block", error: expect.any(String) }]);
    expect(existsSync(join(dir, "compositions", "my-block.html"))).toBe(true);
  });

  it("says --dir is the project root when it does not exist", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const missing = join(dir, "compositions", "new-folder");

    await expect(
      runWrapped(["my-block", "--dir", missing, "--no-clipboard", "--json"]),
    ).rejects.toMatchObject({ result: { exitCode: 1 } });

    const out = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(out.error.message).toContain(`Project folder not found: ${missing}`);
    expect(out.error.message).toContain("--dir is the project root");
    expect(out.error.message).toContain(
      `Create one with \`hyperframes init ${JSON.stringify(missing)}\``,
    );
    expect(existsSync(missing)).toBe(false);
  });

  it("still installs a single name the way it did", async () => {
    await expect(
      runWrapped(["my-block", "--dir", dir, "--no-clipboard", "--json"]),
    ).resolves.toBeUndefined();
  });
});

describe("describeInstallFailure", () => {
  it("explains a bare transport failure instead of echoing it", () => {
    // What the user actually sees after copying a command off the catalog page.
    // Item FILES are not cached, so a blip surfaces as node's `fetch failed`
    // with no URL and no cause, and reads like the command was wrong.
    const message = describeInstallFailure(new Error("fetch failed"));

    expect(message).toContain("could not download the item's files");
    expect(message).toContain("rather than a bad command");
    expect(message).toContain("HTTPS_PROXY");
  });

  it("names the project's own registry when it is not the public one", () => {
    // The reported failure: hyperframes.json pointed at a private host with a
    // self-signed certificate. Telling that reader to check their connection
    // sends them to debug the one thing that was working.
    const message = describeInstallFailure(
      new Error("fetch failed"),
      "https://private.example/registry",
    );

    expect(message).toContain("https://private.example/registry");
    expect(message).toContain("not the public registry");
  });

  it("stays quiet about the registry when it is the default one", () => {
    const message = describeInstallFailure(
      new Error("fetch failed"),
      "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
    );

    expect(message).not.toContain("not the public registry");
  });

  it("leaves a non-transport failure exactly as it was", () => {
    // An unsafe target or a malformed item is the caller's problem to read; a
    // connectivity lecture there would send them to fix the wrong thing.
    const message = describeInstallFailure(new Error('Unsafe target "../x"'));

    expect(message).toBe('Install failed: Unsafe target "../x"');
  });
});

describe("tagAddJson", () => {
  it("carries every installed item's warnings", () => {
    const result = (name: string, warnings: string[]) => ({ name, warnings }) as RunAddResult;
    expect(tagAddJson("lower-thirds", [result("a", []), result("b", ["no id"])])).toEqual({
      ok: true,
      tag: "lower-thirds",
      installed: ["a", "b"],
      warnings: ["b: no id"],
      errors: [],
    });
  });
});

describe("tag installation failures", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmp();
    writeRegistryConfig(dir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    { names: ["my-block"], failed: ["my-block"], installed: [], json: true },
    {
      names: ["my-block", "deprecated-block"],
      failed: ["my-block"],
      installed: ["deprecated-block"],
      json: true,
    },
    { names: ["my-block"], failed: [], installed: ["my-block"], json: true },
    { names: ["my-block"], failed: ["my-block"], installed: [], json: false },
    { names: ["my-block"], failed: [], installed: ["my-block"], json: false },
  ])("reports failed downloads and keeps successful installs: %j", async (scenario) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(input);
        if (url.pathname.endsWith("/registry.json")) {
          return Response.json({
            ...MANIFEST,
            items: MANIFEST.items.filter((item) => scenario.names.includes(item.name)),
          });
        }
        const name = scenario.names.find((item) => url.pathname.includes(`/blocks/${item}/`));
        if (!name) return new Response("not found", { status: 404 });
        if (url.pathname.endsWith("/registry-item.json")) {
          return Response.json({ ...ITEM_BY_NAME[name], tags: ["test-tag"] });
        }
        if (scenario.failed.includes(name)) return new Response("not found", { status: 404 });
        return new Response(FILE_BODIES[`${name}.html`]);
      }),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const run = runCittyCommand(addCommand, {
      rawArgs: ["test-tag", "--dir", dir, "--no-clipboard", ...(scenario.json ? ["--json"] : [])],
    });
    if (scenario.failed.length > 0) {
      await expect(run).rejects.toMatchObject({ result: { exitCode: 1, presented: true } });
    } else {
      await expect(run).resolves.toBeDefined();
    }

    if (scenario.json) {
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
        ok: scenario.failed.length === 0,
        tag: "test-tag",
        installed: scenario.installed,
        errors: scenario.failed.map((name) => ({
          name,
          error: expect.stringContaining("HTTP 404"),
        })),
      });
    } else {
      expect(log).toHaveBeenLastCalledWith(
        `${scenario.failed.length > 0 ? "✗" : "✓"} Installed ${scenario.installed.length}/${scenario.names.length} blocks`,
      );
      if (scenario.failed.length > 0) {
        expect(log.mock.calls.flat().join(" ")).toContain("HTTP 404");
      }
    }
    for (const name of scenario.names) {
      expect(existsSync(join(dir, "compositions", `${name}.html`))).toBe(
        scenario.installed.includes(name),
      );
    }
  });
});

describe("installs from the registry a received hyperframes.json names", () => {
  let dir: string;
  const recordPath = () => join(dir, ".hyperframes", "received-files.json");
  const listed = () => JSON.parse(readFileSync(recordPath(), "utf-8")).files;
  const receive = (files: string[]) => {
    mkdirSync(join(dir, ".hyperframes"));
    writeFileSync(recordPath(), JSON.stringify({ files }));
  };
  const writeConfig = (registry: string, name = "hyperframes.json", prefix = "") =>
    writeFileSync(join(dir, name), prefix + JSON.stringify({ registry }));

  beforeEach(() => {
    dir = tmp();
    mockFetch();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists every file the install writes as received, dependencies included", async () => {
    writeConfig(uniqueBase());
    receive(["hyperframes.json"]);

    await runAdd({ name: "dep-block", projectDir: dir, skipClipboard: true });

    expect(listed()).toEqual([
      "compositions/components/base-component/base-component.css",
      "compositions/dep-block.html",
      "hyperframes.json",
    ]);
  });

  it("keeps a publish from carrying an outside file the installed block names", async () => {
    mkdirSync(join(dir, "shared"));
    writeFileSync(join(dir, "shared", "logo.png"), "png");
    const project = join(dir, "p");
    mkdirSync(join(project, ".hyperframes"), { recursive: true });
    writeFileSync(join(project, "hyperframes.json"), JSON.stringify({ registry: uniqueBase() }));
    writeFileSync(
      join(project, ".hyperframes", "received-files.json"),
      JSON.stringify({ files: ["hyperframes.json"] }),
    );
    writeFileSync(join(project, "index.html"), `<div data-composition-id="main"></div>`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(input);
        if (url.pathname.endsWith("/registry.json")) return Response.json(MANIFEST);
        if (url.pathname.endsWith("/blocks/my-block/registry-item.json"))
          return Response.json(BLOCK_ITEM);
        return new Response(`<div data-composition-id="b"><img src="../../shared/logo.png"></div>`);
      }),
    );

    await runAdd({ name: "my-block", projectDir: project, skipClipboard: true });

    const staged = stagePublishFiles(project, Infinity, () => {});
    expect([...staged.keys()].filter((key) => key.startsWith("_ext/"))).toEqual([]);
  });

  it("lists what an install by tag writes", async () => {
    writeConfig(uniqueBase());
    receive(["hyperframes.json"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(input);
        if (url.pathname.endsWith("/registry.json")) return Response.json(MANIFEST);
        if (url.pathname.endsWith("/blocks/my-block/registry-item.json"))
          return Response.json({ ...BLOCK_ITEM, tags: ["test-tag"] });
        if (url.pathname.endsWith("/blocks/my-block/my-block.html"))
          return new Response(FILE_BODIES["my-block.html"]);
        return new Response("not found", { status: 404 });
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCittyCommand(addCommand, { rawArgs: ["test-tag", "--dir", dir, "--no-clipboard"] });

    expect(listed()).toEqual(["compositions/my-block.html", "hyperframes.json"]);
  });

  it("reads a received config that starts with a byte-order mark", async () => {
    writeConfig(uniqueBase(), "hyperframes.json", "\uFEFF");
    receive(["hyperframes.json"]);

    await runAdd({ name: "my-block", projectDir: dir, skipClipboard: true });

    expect(listed()).toEqual(["compositions/my-block.html", "hyperframes.json"]);
  });

  it("finds a received config listed under another spelling of the file it opens", async () => {
    writeConfig(uniqueBase(), "HyperFrames.json");
    // A disk that tells case apart gets a second name for the same file, as one that ignores case has.
    if (!existsSync(join(dir, "hyperframes.json")))
      linkSync(join(dir, "HyperFrames.json"), join(dir, "hyperframes.json"));
    receive(["HyperFrames.json"]);

    await runAdd({ name: "my-block", projectDir: dir, skipClipboard: true });

    expect(listed()).toEqual(["HyperFrames.json", "compositions/my-block.html"]);
  });

  it("leaves what a person's own config installs off the record", async () => {
    writeConfig(uniqueBase());

    await runAdd({ name: "my-block", projectDir: dir, skipClipboard: true });

    expect(existsSync(join(dir, "compositions/my-block.html"))).toBe(true);
    expect(existsSync(recordPath())).toBe(false);
  });

  it("leaves what the public registry installs off the record", async () => {
    writeConfig(`${DEFAULT_REGISTRY_URL}/${crypto.randomUUID()}`);
    receive(["hyperframes.json"]);

    await runAdd({ name: "my-block", projectDir: dir, skipClipboard: true });

    expect(existsSync(join(dir, "compositions/my-block.html"))).toBe(true);
    expect(listed()).toEqual(["hyperframes.json"]);
  });

  it("takes back what a failed install listed but never wrote", async () => {
    writeConfig(uniqueBase());
    receive(["hyperframes.json"]);
    failingWrite.failing = "base-component.css";
    try {
      await expect(
        runAdd({ name: "dep-block", projectDir: dir, skipClipboard: true }),
      ).rejects.toThrow(AddError);
    } finally {
      failingWrite.failing = null;
    }
    expect(listed()).toEqual(["hyperframes.json"]);
  });

  it("leaves off a file the person edited while the install downloaded", async () => {
    writeConfig(uniqueBase());
    await runAdd({ name: "my-block", projectDir: dir, skipClipboard: true });
    receive(["hyperframes.json"]);
    const block = join(dir, "compositions", "my-block.html");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(input);
        if (url.pathname.endsWith("/registry.json")) return Response.json(MANIFEST);
        if (url.pathname.endsWith("/registry-item.json")) return Response.json(BLOCK_ITEM);
        writeFileSync(block, "<div>the person's edit</div>");
        return new Response(FILE_BODIES["my-block.html"]);
      }),
    );

    const result = await runAdd({ name: "my-block", projectDir: dir, skipClipboard: true });

    expect(result.preserved).toHaveLength(1);
    expect(readFileSync(block, "utf-8")).toBe("<div>the person's edit</div>");
    expect(listed()).toEqual(["hyperframes.json"]);
  });

  it("counts a hyperframes.json it cannot parse as received, not as the person's own", async () => {
    vi.stubEnv("HYPERFRAMES_CACHE_DIR", tmp());
    writeFileSync(join(dir, "hyperframes.json"), "{ not json");

    await runAdd({ name: "my-block", projectDir: dir, skipClipboard: true });

    expect(listed()).toEqual(["compositions/my-block.html"]);
  });

  it("keeps a failed install's files that are on disk listed", async () => {
    writeConfig(uniqueBase());
    receive(["hyperframes.json"]);
    failingWrite.failing = "dep-block.html";
    try {
      await expect(
        runAdd({ name: "dep-block", projectDir: dir, skipClipboard: true }),
      ).rejects.toThrow(AddError);
    } finally {
      failingWrite.failing = null;
    }
    expect(listed()).toEqual([
      "compositions/components/base-component/base-component.css",
      "hyperframes.json",
    ]);
  });

  it("leaves a record it cannot read as it is", async () => {
    writeConfig(uniqueBase());
    mkdirSync(join(dir, ".hyperframes"));
    writeFileSync(recordPath(), "{oops");

    await runAdd({ name: "my-block", projectDir: dir, skipClipboard: true });

    expect(readFileSync(recordPath(), "utf-8")).toBe("{oops");
  });
});
