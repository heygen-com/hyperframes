import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_PROJECT_CONFIG,
  loadProjectConfig,
  normalizeConfig,
  projectConfigPath,
  readProjectConfig,
  resolveAutoProxy,
  writeProjectConfig,
  PROJECT_CONFIG_FILENAME,
} from "./projectConfig.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "hf-cfg-test-"));
}

describe("projectConfig", () => {
  describe("write + read round-trip", () => {
    it("writes the default config and reads it back", () => {
      const dir = tmp();
      try {
        writeProjectConfig(dir);
        const read = readProjectConfig(dir);
        expect(read).toEqual(DEFAULT_PROJECT_CONFIG);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("writes a custom config and reads it back verbatim", () => {
      const dir = tmp();
      try {
        const custom = {
          $schema: DEFAULT_PROJECT_CONFIG.$schema,
          registry: "https://example.com/my-registry",
          paths: { blocks: "src/blocks", components: "src/fx", assets: "media" },
          media: { autoProxy: true },
        };
        writeProjectConfig(dir, custom);
        const read = readProjectConfig(dir);
        expect(read).toEqual(custom);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("normalizeConfig", () => {
    it("fills in defaults for missing fields", () => {
      const result = normalizeConfig({ registry: "https://alt.example.com" });
      expect(result.registry).toBe("https://alt.example.com");
      expect(result.paths).toEqual(DEFAULT_PROJECT_CONFIG.paths);
      expect(result.$schema).toBe(DEFAULT_PROJECT_CONFIG.$schema);
    });

    it("preserves partial paths objects", () => {
      const result = normalizeConfig({ paths: { blocks: "x" } as unknown as never });
      expect(result.paths.blocks).toBe("x");
      expect(result.paths.components).toBe(DEFAULT_PROJECT_CONFIG.paths.components);
      expect(result.paths.assets).toBe(DEFAULT_PROJECT_CONFIG.paths.assets);
    });

    it("defaults media.autoProxy to true when media is absent", () => {
      const result = normalizeConfig({ registry: "https://alt.example.com" });
      expect(result.media).toEqual({ autoProxy: true });
    });

    it("preserves an explicit media.autoProxy: false", () => {
      const result = normalizeConfig({ media: { autoProxy: false } });
      expect(result.media).toEqual({ autoProxy: false });
    });

    it("falls back to the default when media.autoProxy is malformed", () => {
      const result = normalizeConfig({
        media: { autoProxy: "nope" } as unknown as never,
      });
      expect(result.media).toEqual({ autoProxy: true });
    });

    it("falls back to the default when media itself is malformed", () => {
      const result = normalizeConfig({ media: "nope" as unknown as never });
      expect(result.media).toEqual({ autoProxy: true });
    });
  });

  describe("readProjectConfig", () => {
    it("returns undefined when the file is absent", () => {
      const dir = tmp();
      try {
        expect(readProjectConfig(dir)).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("returns undefined when the file is corrupt", () => {
      const dir = tmp();
      try {
        writeFileSync(projectConfigPath(dir), "{ not valid json", "utf-8");
        expect(readProjectConfig(dir)).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("normalizes a partial on-disk config", () => {
      const dir = tmp();
      try {
        writeFileSync(
          projectConfigPath(dir),
          JSON.stringify({ registry: "https://only-this.example.com" }),
          "utf-8",
        );
        const read = readProjectConfig(dir);
        expect(read?.registry).toBe("https://only-this.example.com");
        expect(read?.paths).toEqual(DEFAULT_PROJECT_CONFIG.paths);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("loadProjectConfig", () => {
    it("returns defaults when no config file exists", () => {
      const dir = tmp();
      try {
        expect(loadProjectConfig(dir)).toEqual(DEFAULT_PROJECT_CONFIG);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("writeProjectConfig", () => {
    it("writes to hyperframes.json at the project root", () => {
      const dir = tmp();
      try {
        writeProjectConfig(dir);
        const path = join(dir, PROJECT_CONFIG_FILENAME);
        const parsed = JSON.parse(readFileSync(path, "utf-8"));
        expect(parsed.registry).toBe(DEFAULT_PROJECT_CONFIG.registry);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("resolveAutoProxy", () => {
    it("defaults to true when no config file exists and no flag is passed", () => {
      const dir = tmp();
      try {
        expect(resolveAutoProxy(dir, undefined)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("returns false when the config sets media.autoProxy: false", () => {
      const dir = tmp();
      try {
        writeFileSync(
          projectConfigPath(dir),
          JSON.stringify({ media: { autoProxy: false } }),
          "utf-8",
        );
        expect(resolveAutoProxy(dir, undefined)).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("defaults to true when the config file is partial and omits media", () => {
      const dir = tmp();
      try {
        writeFileSync(
          projectConfigPath(dir),
          JSON.stringify({ registry: "https://only-this.example.com" }),
          "utf-8",
        );
        expect(resolveAutoProxy(dir, undefined)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("an explicit false flag wins over a config that enables it", () => {
      const dir = tmp();
      try {
        writeFileSync(
          projectConfigPath(dir),
          JSON.stringify({ media: { autoProxy: true } }),
          "utf-8",
        );
        expect(resolveAutoProxy(dir, false)).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("an explicit true flag wins over a config that disables it", () => {
      const dir = tmp();
      try {
        writeFileSync(
          projectConfigPath(dir),
          JSON.stringify({ media: { autoProxy: false } }),
          "utf-8",
        );
        expect(resolveAutoProxy(dir, true)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("falls back to the default when the on-disk media value is malformed", () => {
      const dir = tmp();
      try {
        writeFileSync(
          projectConfigPath(dir),
          JSON.stringify({ media: { autoProxy: "nope" } }),
          "utf-8",
        );
        expect(resolveAutoProxy(dir, undefined)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
