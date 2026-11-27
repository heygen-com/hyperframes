import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { RegistryItem } from "@hyperframes/core";

// The installer fetches over the network; the point of these tests is what it
// does to files on disk, so the fetch returns controlled bytes.
const remote = vi.hoisted(() => ({ contents: "REGISTRY VERSION\n" }));
vi.mock("./remote.js", () => ({
  DEFAULT_REGISTRY_URL: "https://example.test/r",
  isPublicRegistry: (registry: string) => registry === "https://example.test/r",
  fetchItemFile: vi.fn(async () => Buffer.from(remote.contents)),
}));

const { hasLocalEdits, installItem, prepareItem, publishItem } = await import("./installer.js");

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-installer-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const item = {
  name: "data-chart",
  title: "Data chart",
  description: "Chart component",
  type: "hyperframes:component",
  files: [
    {
      path: "data-chart.html",
      target: "compositions/data-chart.html",
      type: "hyperframes:snippet",
    },
  ],
} as unknown as RegistryItem;

const target = "compositions/data-chart.html";

describe("hasLocalEdits", () => {
  it("treats a file with no record as edited", () => {
    // Covers a project that wrote the file itself, and one that installed
    // before the record existed. Both would rather keep what they have.
    expect(hasLocalEdits({}, target, "anything")).toBe(true);
  });

  it("treats a file matching its record as untouched", () => {
    const contents = "exactly what we installed";
    const record = { [target]: createHash("sha256").update(contents).digest("hex") };
    expect(hasLocalEdits(record, target, contents)).toBe(false);
  });

  it("treats a file that no longer matches its record as edited", () => {
    const record = { [target]: createHash("sha256").update("original").digest("hex") };
    expect(hasLocalEdits(record, target, "changed")).toBe(true);
  });
});

describe("installItem", () => {
  it("rejects a target directory symlink that escapes the project even with force", async () => {
    const dir = project();
    const outside = project();
    symlinkSync(outside, join(dir, "compositions"), "junction");
    await expect(installItem(item, { destDir: dir, force: true })).rejects.toThrow(/Unsafe target/);
    expect(existsSync(join(outside, "data-chart.html"))).toBe(false);
  });
  it.each([
    ".git/hooks/pre-commit",
    "GIT~1/hooks/pre-commit",
    ".claude/settings.json",
    ".vscode/tasks.json",
    "compositions/.husky/pre-commit",
    ".npmrc",
    "assets/.env",
    "package.json",
    "hyperframes.json",
    "hyperframes.lock.json",
    "CLAUDE~1/settings.json",
    "VSCODE~1/tasks.json",
    "PACKAG~1.JSO",
    "NPMRC~1",
  ])("refuses the configuration target %s before writing anything", async (configTarget) => {
    const dir = project();
    const planted = { ...item, files: [{ ...item.files[0]!, target: configTarget }] };
    await expect(installItem(planted, { destDir: dir, force: true })).rejects.toThrow(
      /Unsafe target/,
    );
    expect(existsSync(join(dir, configTarget))).toBe(false);
  });

  it.each([
    "node_modules/@hyperframes/core/audio-carve.js",
    "compositions/node_modules/pkg/index.js",
    "Node_Modules\\pkg\\index.js",
    "compositions/CLAUDE.md",
    "compositions\\AGENTS.md",
    "assets/Claude.local.md",
    "GEMINI.md",
    "QWEN.md",
    "CONVENTIONS.md",
    "compositions/QWEN.md",
    "assets/Crush.md",
    "compositions\\WARP.md",
    "compositions/conventions.md",
    "notes.txt",
    "whisper-cli.exe",
    "assets/whisper-cli.EXE",
    "compositions/conftest.py",
    "lib/install.sh",
    "vite.config.js",
    "index.html",
    "src/index.js",
    "scripts\\postinstall.js",
    "lib/package.json",
    "compositions/pnpm-lock.yaml",
    "lib/tsconfig.json",
    "lib/vite.config.ts",
    "compositions/Makefile",
    "lib/AGENTS.md::$DATA",
    "lib/binding.gyp",
    "assets/common.gypi",
    "compositions/server.js",
  ])("refuses the install target %s before writing anything", async (planted) => {
    const dir = project();
    const hostile = { ...item, files: [{ ...item.files[0]!, target: planted }] };
    await expect(installItem(hostile, { destDir: dir, force: true })).rejects.toThrow(
      /Unsafe target/,
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  const withTarget = (planted: string) => ({
    ...item,
    files: [{ ...item.files[0]!, target: planted }],
  });
  const scaffoldManifest = { name: "film", private: true, scripts: { dev: "hyperframes preview" } };
  const nodeManifest = { name: "app", devDependencies: { vitest: "^3.0.0" } };
  const otherRegistry = "https://registry.other.test/r";
  const registries = [undefined, otherRegistry];

  it.each([
    "compositions/chart.test.ts",
    "lib/widget.tsx",
    "compositions/loader.mts",
    "assets/setup.cts",
    "lib/view.jsx",
    "compositions/hook.cjs",
    "lib/UPPER.TS",
    "lib\\trailing.ts.",
    "scenes/extra.spec.ts",
  ])(
    "refuses the Node-only script %s from any registry, in a scaffolded project and a bare folder",
    async (planted) => {
      for (const baseUrl of registries) {
        for (const manifest of [null, scaffoldManifest]) {
          const dir = project();
          if (manifest) writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
          const options = { destDir: dir, force: true, installDirs: ["scenes"], baseUrl };
          await expect(installItem(withTarget(planted), options)).rejects.toThrow(
            /Unsafe target.*script Node tooling may run/,
          );
          expect(readdirSync(dir)).toEqual(manifest ? ["package.json"] : []);
        }
      }
    },
  );

  it.each(["lib/shaders.iife.js", "compositions/__tests__/chart.test.js", "assets/motion.mjs"])(
    "installs the browser script %s from another registry unless the project brings its own Node tooling",
    async (planted) => {
      const from = { baseUrl: otherRegistry };
      for (const manifest of [null, scaffoldManifest]) {
        const dir = project();
        if (manifest) writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
        await installItem(withTarget(planted), { destDir: dir, ...from });
        expect(existsSync(join(dir, planted))).toBe(true);
      }
      const dir = project();
      writeFileSync(join(dir, "package.json"), JSON.stringify(nodeManifest));
      await expect(
        installItem(withTarget(planted), { destDir: dir, force: true, ...from }),
      ).rejects.toThrow(/Unsafe target.*script Node tooling may run/);
      expect(readdirSync(dir)).toEqual(["package.json"]);
    },
  );

  it("installs a public registry browser script in a project with its own Node tooling", async () => {
    const dir = project();
    writeFileSync(join(dir, "package.json"), JSON.stringify(nodeManifest));
    await installItem(withTarget("lib/shaders.iife.js"), { destDir: dir });
    expect(existsSync(join(dir, "lib", "shaders.iife.js"))).toBe(true);
  });

  it("refuses, from another registry, a file Node would load before the project's module beside it", async () => {
    const dir = project();
    writeFileSync(join(dir, "package.json"), JSON.stringify(nodeManifest));
    mkdirSync(join(dir, "lib"));
    writeFileSync(join(dir, "lib", "db.utils.js"), "module.exports = {};\n");
    await expect(
      installItem(withTarget("lib/db.utils"), {
        destDir: dir,
        force: true,
        baseUrl: otherRegistry,
      }),
    ).rejects.toThrow(/Unsafe target.*script Node tooling may run/);
    expect(readdirSync(join(dir, "lib"))).toEqual(["db.utils.js"]);
  });

  it("refuses a browser script the project's own link leads below a Node package", async () => {
    const dir = project();
    mkdirSync(join(dir, "tools", "pkg"), { recursive: true });
    writeFileSync(join(dir, "tools", "package.json"), JSON.stringify(nodeManifest));
    symlinkSync(join(dir, "tools", "pkg"), join(dir, "lib"), "junction");
    await expect(
      installItem(withTarget("lib/shaders.iife.js"), {
        destDir: dir,
        force: true,
        baseUrl: otherRegistry,
      }),
    ).rejects.toThrow(/Unsafe target.*script Node tooling may run/);
    expect(readdirSync(join(dir, "tools", "pkg"))).toEqual([]);
  });

  it("refuses a browser script below a mixed-case folder that holds a Node package, directly or through a link", async () => {
    const options = { force: true, baseUrl: otherRegistry };
    const direct = project();
    mkdirSync(join(direct, "compositions", "Widgets"), { recursive: true });
    writeFileSync(
      join(direct, "compositions", "Widgets", "package.json"),
      JSON.stringify(nodeManifest),
    );
    await expect(
      installItem(withTarget("compositions/Widgets/chart.test.js"), {
        destDir: direct,
        ...options,
      }),
    ).rejects.toThrow(/Unsafe target.*script Node tooling may run/);
    expect(readdirSync(join(direct, "compositions", "Widgets"))).toEqual(["package.json"]);

    const linked = project();
    mkdirSync(join(linked, "tools", "Pkg", "src"), { recursive: true });
    writeFileSync(join(linked, "tools", "Pkg", "package.json"), JSON.stringify(nodeManifest));
    symlinkSync(join(linked, "tools", "Pkg", "src"), join(linked, "lib"), "junction");
    await expect(
      installItem(withTarget("lib/shaders.iife.js"), { destDir: linked, ...options }),
    ).rejects.toThrow(/Unsafe target.*script Node tooling may run/);
    expect(readdirSync(join(linked, "tools", "Pkg", "src"))).toEqual([]);
  });

  it("refuses a page whose own file link leads to a Node-only script", async () => {
    const dir = project();
    mkdirSync(join(dir, "tools"));
    mkdirSync(join(dir, "compositions"));
    writeFileSync(join(dir, "tools", "run.ts"), "export {};\n");
    symlinkSync(join(dir, "tools", "run.ts"), join(dir, "compositions", "data-chart.html"));
    await expect(installItem(item, { destDir: dir, force: true })).rejects.toThrow(
      /Unsafe target.*script Node tooling may run/,
    );
    expect(readFileSync(join(dir, "tools", "run.ts"), "utf8")).toBe("export {};\n");
  });

  it("writes into the standard folders, the configured ones and root notes", async () => {
    const dir = project();
    const targets = [
      "compositions/a.html",
      "compositions/components/b.html",
      "assets/fonts/c.woff2",
      "models/d.glb",
      "lib/e.iife.js",
      "TEMPLATE.md",
      "scenes/f.html",
    ];
    const files = targets.map((name) => ({ ...item.files[0]!, path: name, target: name }));
    await expect(installItem({ ...item, files }, { destDir: dir })).rejects.toThrow(
      /scenes\/f\.html.*outside the project's blocks/,
    );
    await installItem({ ...item, files }, { destDir: dir, installDirs: ["scenes/"] });
    for (const name of targets) expect(existsSync(join(dir, name))).toBe(true);
  });

  it.each([".", "", "node_modules", ".claude", "./"])(
    "opens nothing for the configured folder %j",
    async (configured) => {
      const dir = project();
      const hostile = { ...item, files: [{ ...item.files[0]!, target: "settings.json" }] };
      await expect(
        installItem(hostile, { destDir: dir, installDirs: [configured] }),
      ).rejects.toThrow(/Unsafe target/);
    },
  );

  it("refuses a target that the project's own link leads into node_modules", async () => {
    const dir = project();
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    symlinkSync(join(dir, "node_modules", "pkg"), join(dir, "compositions"), "junction");
    await expect(installItem(item, { destDir: dir, force: true })).rejects.toThrow(/node_modules/);
    expect(readdirSync(join(dir, "node_modules", "pkg"))).toEqual([]);
  });

  it("accepts every target in the official catalog", async () => {
    const registry = join(dirname(fileURLToPath(import.meta.url)), "../../../../registry");
    const dir = project();
    let checked = 0;
    for (const kind of ["blocks", "components", "examples"]) {
      for (const name of readdirSync(join(registry, kind))) {
        const manifest = join(registry, kind, name, "registry-item.json");
        if (!existsSync(manifest)) continue;
        const official = JSON.parse(readFileSync(manifest, "utf8")) as RegistryItem;
        await prepareItem(official, { destDir: dir });
        checked += official.files.length;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("lets an example bring its own package.json and .gitignore", async () => {
    const dir = project();
    const example = {
      ...item,
      type: "hyperframes:example",
      dimensions: { width: 1920, height: 1080 },
      duration: 10,
      files: ["package.json", ".gitignore", "assets/.gitkeep"].map((name) => ({
        path: name,
        target: name,
        type: "hyperframes:asset",
      })),
    } as unknown as RegistryItem;
    await installItem(example, { destDir: dir, force: true });
    expect(existsSync(join(dir, "package.json"))).toBe(true);
    expect(existsSync(join(dir, ".gitignore"))).toBe(true);
  });

  it.each(["binding.gyp", "server.js"])(
    "refuses an example's %s, which a package manager runs on its own",
    async (name) => {
      const dir = project();
      const example = {
        ...item,
        type: "hyperframes:example",
        dimensions: { width: 1920, height: 1080 },
        duration: 10,
        files: [{ path: name, target: name, type: "hyperframes:asset" }],
      } as unknown as RegistryItem;
      await expect(installItem(example, { destDir: dir, force: true })).rejects.toThrow(
        /Unsafe target/,
      );
      expect(readdirSync(dir)).toEqual([]);
    },
  );

  it("preserves directory symlinks whose destination stays inside the project", async () => {
    const dir = project();
    mkdirSync(join(dir, "actual"));
    symlinkSync(join(dir, "actual"), join(dir, "compositions"), "junction");
    await installItem(item, { destDir: dir, force: true });
    expect(readFileSync(join(dir, "actual/data-chart.html"), "utf8")).toContain("REGISTRY VERSION");
  });
  it.each(["darwin", "win32"] as const)(
    "rejects absent case and Unicode aliases on %s before downloads",
    async (platform) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      try {
        for (const names of [
          ["Foo.html", "foo.html"],
          ["Café.html", "Cafe\u0301.html"],
        ]) {
          const dir = project();
          const conflicting = {
            ...item,
            files: names.map((name) => ({ ...item.files[0]!, target: `compositions/${name}` })),
          };
          await expect(installItem(conflicting, { destDir: dir, force: true })).rejects.toThrow(
            /duplicate/,
          );
          expect(existsSync(join(dir, "compositions"))).toBe(false);
        }
      } finally {
        vi.restoreAllMocks();
      }
    },
  );
  it("records what it installed, so a later install can tell", async () => {
    const dir = project();
    const result = await installItem(item, { destDir: dir });

    expect(result.written).toHaveLength(1);
    expect(result.preserved).toEqual([]);
    const record = JSON.parse(readFileSync(join(dir, "hyperframes.lock.json"), "utf-8"));
    expect(record[target]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("replaces a file the project has not touched", async () => {
    const dir = project();
    await installItem(item, { destDir: dir });

    remote.contents = "REGISTRY VERSION 2\n";
    const again = await installItem(item, { destDir: dir });
    remote.contents = "REGISTRY VERSION\n";

    expect(again.preserved).toEqual([]);
    expect(readFileSync(join(dir, target), "utf-8")).toBe("REGISTRY VERSION 2\n");
  });

  it("keeps a file the project has edited", async () => {
    const dir = project();
    await installItem(item, { destDir: dir });
    writeFileSync(join(dir, target), "MY OWN COLOURS\n", "utf-8");

    const again = await installItem(item, { destDir: dir });

    expect(again.written).toEqual([]);
    expect(again.preserved).toHaveLength(1);
    expect(readFileSync(join(dir, target), "utf-8")).toBe("MY OWN COLOURS\n");
  });

  it("keeps an edit saved while the rest of the plan was still downloading", async () => {
    const dir = project();
    await installItem(item, { destDir: dir });
    remote.contents = "REGISTRY VERSION 2\n";
    const prepared = await prepareItem(item, { destDir: dir });
    remote.contents = "REGISTRY VERSION\n";
    writeFileSync(join(dir, target), "MY OWN COLOURS\n", "utf-8");

    const result = publishItem(prepared);

    expect(result.written).toEqual([]);
    expect(result.preserved).toHaveLength(1);
    expect(readFileSync(join(dir, target), "utf-8")).toBe("MY OWN COLOURS\n");
  });

  it("keeps a file that was there before any install", async () => {
    const dir = project();
    mkdirSync(join(dir, "compositions"), { recursive: true });
    writeFileSync(join(dir, target), "PRE-EXISTING\n", "utf-8");

    const result = await installItem(item, { destDir: dir });

    expect(result.preserved).toHaveLength(1);
    expect(readFileSync(join(dir, target), "utf-8")).toBe("PRE-EXISTING\n");
  });

  it("overwrites an edited file when forced", async () => {
    const dir = project();
    await installItem(item, { destDir: dir });
    writeFileSync(join(dir, target), "MY OWN COLOURS\n", "utf-8");

    const forced = await installItem(item, { destDir: dir, force: true });

    expect(forced.preserved).toEqual([]);
    expect(readFileSync(join(dir, target), "utf-8")).toBe("REGISTRY VERSION\n");
  });

  it("does not read its own edit back as the project's", async () => {
    // A block composition gets a marker comment added after fetching. Recording
    // the pre-marker bytes would make every reinstall look like an edit.
    const block = {
      name: "hero",
      title: "Hero",
      description: "Hero block",
      dimensions: { width: 100, height: 100 },
      duration: 1,
      type: "hyperframes:block",
      files: [
        { path: "hero.html", target: "compositions/hero.html", type: "hyperframes:composition" },
      ],
    } as unknown as RegistryItem;

    const dir = project();
    await installItem(block, { destDir: dir });
    const second = await installItem(block, { destDir: dir });

    expect(second.preserved).toEqual([]);
    expect(second.written).toHaveLength(1);
  });
});

describe("installing several items, as a dependency plan does", () => {
  const other = {
    name: "shared-caption",
    title: "Shared caption",
    description: "Shared component",
    type: "hyperframes:component",
    files: [
      {
        path: "shared-caption.html",
        target: "compositions/shared-caption.html",
        type: "hyperframes:snippet",
      },
    ],
  } as unknown as RegistryItem;

  const otherTarget = "compositions/shared-caption.html";

  it("keeps a record for every item, not just the last one installed", () => {
    // `add` installs dependencies first and the requested item last. A record
    // rewritten per item rather than merged would forget the dependency, and
    // the next install would read it as edited and refuse to update it.
    const dir = project();
    return installItem(item, { destDir: dir })
      .then(() => installItem(other, { destDir: dir }))
      .then(() => {
        const record = JSON.parse(readFileSync(join(dir, "hyperframes.lock.json"), "utf-8"));
        expect(Object.keys(record).sort()).toEqual([otherTarget, target].sort());
      });
  });

  it("preserves an edit to one item while updating another", async () => {
    const dir = project();
    await installItem(item, { destDir: dir });
    await installItem(other, { destDir: dir });
    writeFileSync(join(dir, target), "EDITED DEPENDENCY\n", "utf-8");

    const edited = await installItem(item, { destDir: dir });
    const untouched = await installItem(other, { destDir: dir });

    expect(edited.preserved).toHaveLength(1);
    expect(untouched.written).toHaveLength(1);
    expect(readFileSync(join(dir, target), "utf-8")).toBe("EDITED DEPENDENCY\n");
  });
});

describe("installing with --vars the item cannot take", () => {
  const declaration = `<div data-composition-id="demo" data-composition-variables='[{"id":"maths","type":"boolean","label":"Maths","default":false}]'></div>`;
  const block = {
    name: "demo-block",
    title: "Demo block",
    description: "Block",
    dimensions: { width: 100, height: 100 },
    duration: 1,
    type: "hyperframes:block",
    files: [
      {
        path: "demo-block.html",
        target: "compositions/demo-block.html",
        type: "hyperframes:composition",
      },
    ],
  } as unknown as RegistryItem;

  it.each([
    ["block", block, "compositions/demo-block.html"],
    ["component", item, target],
  ])(
    "refuses a wrong-typed value for a %s and writes nothing",
    async (_kind, installable, file) => {
      const dir = project();
      remote.contents = declaration;
      try {
        await expect(
          installItem(installable, { destDir: dir, variableValues: { maths: 1 } }),
        ).rejects.toThrow(/maths: expected boolean, got number/);
        expect(existsSync(join(dir, file))).toBe(false);
      } finally {
        remote.contents = "REGISTRY VERSION\n";
      }
    },
  );
});
