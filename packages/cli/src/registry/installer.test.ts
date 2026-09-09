import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RegistryItem } from "@hyperframes/core";

// The installer fetches over the network; the point of these tests is what it
// does to files on disk, so the fetch returns controlled bytes.
const remote = vi.hoisted(() => ({ contents: "REGISTRY VERSION\n" }));
vi.mock("./remote.js", () => ({
  DEFAULT_REGISTRY_URL: "https://example.test/r",
  fetchItemFile: vi.fn(async () => Buffer.from(remote.contents)),
}));

const { hasLocalEdits, installItem } = await import("./installer.js");

function project(): string {
  return mkdtempSync(join(tmpdir(), "hf-installer-"));
}

const item = {
  name: "data-chart",
  title: "Data chart",
  description: "Chart component",
  type: "hyperframes:component",
  files: [
    { path: "data-chart.html", target: "components/data-chart.html", type: "hyperframes:snippet" },
  ],
} as unknown as RegistryItem;

const target = "components/data-chart.html";

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
    try {
      symlinkSync(outside, join(dir, "components"), "junction");
      await expect(installItem(item, { destDir: dir, force: true })).rejects.toThrow(
        /Unsafe target/,
      );
      expect(existsSync(join(outside, "data-chart.html"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
  it("preserves directory symlinks whose destination stays inside the project", async () => {
    const dir = project();
    try {
      mkdirSync(join(dir, "actual"));
      symlinkSync(join(dir, "actual"), join(dir, "components"), "junction");
      await installItem(item, { destDir: dir, force: true });
      expect(readFileSync(join(dir, "actual/data-chart.html"), "utf8")).toContain(
        "REGISTRY VERSION",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
          try {
            const conflicting = {
              ...item,
              files: names.map((name) => ({ ...item.files[0]!, target: `components/${name}` })),
            };
            await expect(installItem(conflicting, { destDir: dir, force: true })).rejects.toThrow(
              /duplicate/,
            );
            expect(existsSync(join(dir, "components"))).toBe(false);
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
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

  it("keeps a file that was there before any install", async () => {
    const dir = project();
    mkdirSync(join(dir, "components"), { recursive: true });
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
      files: [{ path: "hero.html", target: "blocks/hero.html", type: "hyperframes:composition" }],
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
        target: "components/shared-caption.html",
        type: "hyperframes:snippet",
      },
    ],
  } as unknown as RegistryItem;

  const otherTarget = "components/shared-caption.html";

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
