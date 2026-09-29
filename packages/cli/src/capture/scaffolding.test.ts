import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateProjectScaffold } from "./scaffolding.js";
import type { DesignTokens } from "./types.js";

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return {
    ...original,
    existsSync: vi.fn(original.existsSync),
    writeFileSync: vi.fn(original.writeFileSync),
    linkSync: vi.fn(original.linkSync),
  };
});

const tokens: DesignTokens = {
  title: "Captured site",
  description: "",
  cssVariables: {},
  fonts: [],
  colors: [],
  headings: [],
  ctas: [],
  svgs: [],
  sections: [],
};

describe("generateProjectScaffold metadata", () => {
  let dir: string;
  let metaPath: string;
  let warnings: string[];
  const progress = vi.fn();

  beforeEach(() => {
    dir = fs.mkdtempSync(join(tmpdir(), "hf-scaffold-"));
    metaPath = join(dir, "meta.json");
    warnings = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(dir)) {
      expect(fs.readdirSync(dir).filter((name) => name.startsWith(".hf-create-"))).toEqual([]);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function generate(url = "https://www.example.com", title = tokens.title) {
    return generateProjectScaffold(
      dir,
      url,
      { ...tokens, title },
      undefined,
      false,
      false,
      false,
      [],
      progress,
      warnings,
    );
  }

  it.each(["Captured site", ""])(
    "creates metadata with title %j and agent instructions",
    async (title) => {
      await generate(undefined, title);
      expect(fs.readFileSync(metaPath, "utf-8")).toBe(
        JSON.stringify({ id: "example.com-video", name: title || "example.com" }, null, 2),
      );
      expect(fs.readFileSync(join(dir, "AGENTS.md"), "utf-8")).toBe(
        fs.readFileSync(join(dir, "CLAUDE.md"), "utf-8"),
      );
      expect(fs.existsSync(join(dir, "index.html"))).toBe(false);
      expect(progress).toHaveBeenCalledWith("agent", "AGENTS.md + CLAUDE.md generated");
      expect(warnings).toEqual([]);
    },
  );

  it("keeps existing metadata without parsing the unused URL", async () => {
    fs.writeFileSync(metaPath, "user metadata");
    await generate("not a URL");
    expect(fs.readFileSync(metaPath, "utf-8")).toBe("user metadata");
  });

  it("preserves a file created after the existence check and continues scaffolding", async () => {
    vi.mocked(fs.existsSync).mockImplementationOnce(() => {
      fs.writeFileSync(metaPath, "concurrent metadata");
      return false;
    });
    await generate();
    expect(fs.readFileSync(metaPath, "utf-8")).toBe("concurrent metadata");
    expect(progress).toHaveBeenCalledWith("agent", "AGENTS.md + CLAUDE.md generated");
    expect(warnings).toEqual([]);
  });

  it("does not follow a dangling metadata symlink", async () => {
    const target = join(dir, "missing-target.json");
    fs.symlinkSync(target, metaPath);
    await generate();
    expect(fs.lstatSync(metaPath).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("propagates write errors other than EEXIST", async () => {
    fs.rmSync(dir, { recursive: true });
    await expect(generate()).rejects.toMatchObject({ code: "ENOENT" });
    expect(progress).not.toHaveBeenCalled();
  });

  it.each(["writeFileSync", "linkSync"] as const)(
    "cleans staging and propagates failures from %s",
    async (operation) => {
      const error = Object.assign(new Error("injected I/O failure"), { code: "EIO" });
      vi.mocked(fs[operation]).mockImplementationOnce(() => {
        throw error;
      });
      await expect(generate()).rejects.toBe(error);
      expect(fs.existsSync(metaPath)).toBe(false);
      expect(progress).not.toHaveBeenCalled();
    },
  );
});
