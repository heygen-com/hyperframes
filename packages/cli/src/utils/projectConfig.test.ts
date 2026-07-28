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
  seedProjectAuthoringSkill,
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

    it("preserves a valid authoringSkill slug", () => {
      const result = normalizeConfig({ authoringSkill: "product-launch-video" });
      expect(result.authoringSkill).toBe("product-launch-video");
    });

    it("drops an invalid authoringSkill (never reaches telemetry)", () => {
      const result = normalizeConfig({
        authoringSkill: "Not A Slug!" as unknown as never,
      });
      expect(result.authoringSkill).toBeUndefined();
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

  describe("seedProjectAuthoringSkill", () => {
    it("stamps the owning skill into a fresh project (creates the config)", () => {
      const dir = tmp();
      try {
        seedProjectAuthoringSkill(dir, "faceless-explainer");
        expect(loadProjectConfig(dir).authoringSkill).toBe("faceless-explainer");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("preserves other config fields when stamping an existing config", () => {
      const dir = tmp();
      try {
        writeProjectConfig(dir, {
          ...DEFAULT_PROJECT_CONFIG,
          registry: "https://custom.example.com",
        });
        seedProjectAuthoringSkill(dir, "pr-to-video");
        const read = readProjectConfig(dir);
        expect(read?.authoringSkill).toBe("pr-to-video");
        expect(read?.registry).toBe("https://custom.example.com");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("is seed-once: a later --skill never overwrites the project owner", () => {
      const dir = tmp();
      try {
        seedProjectAuthoringSkill(dir, "product-launch-video");
        seedProjectAuthoringSkill(dir, "motion-graphics");
        expect(loadProjectConfig(dir).authoringSkill).toBe("product-launch-video");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("ignores an invalid slug and writes nothing", () => {
      const dir = tmp();
      try {
        seedProjectAuthoringSkill(dir, "Not A Slug!");
        expect(readProjectConfig(dir)).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    // The seed is the only writer that touches an existing hyperframes.json,
    // which is normally committed — a render must not diff it beyond the one
    // key being added. Guards against round-tripping through normalizeConfig.
    it("preserves config keys outside the known schema", () => {
      const dir = tmp();
      try {
        writeFileSync(
          projectConfigPath(dir),
          JSON.stringify(
            {
              registry: "https://example.com/my-registry",
              myTeamSetting: { reviewer: "wenbo", keep: true },
              futureSchemaKey: 42,
            },
            null,
            2,
          ),
          "utf-8",
        );
        seedProjectAuthoringSkill(dir, "product-launch-video");
        const raw = JSON.parse(readFileSync(projectConfigPath(dir), "utf-8"));
        expect(raw.authoringSkill).toBe("product-launch-video");
        expect(raw.myTeamSetting).toEqual({ reviewer: "wenbo", keep: true });
        expect(raw.futureSchemaKey).toBe(42);
        expect(raw.registry).toBe("https://example.com/my-registry");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("does not materialize a media block the user never wrote", () => {
      const dir = tmp();
      try {
        writeFileSync(
          projectConfigPath(dir),
          JSON.stringify({ registry: "https://example.com/r" }, null, 2),
          "utf-8",
        );
        seedProjectAuthoringSkill(dir, "motion-graphics");
        const raw = JSON.parse(readFileSync(projectConfigPath(dir), "utf-8"));
        expect(raw.media).toBeUndefined();
        expect(raw.$schema).toBeUndefined();
        expect(Object.keys(raw)).toEqual(["registry", "authoringSkill"]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("reuses the file's own indentation", () => {
      const dir = tmp();
      try {
        writeFileSync(
          projectConfigPath(dir),
          JSON.stringify({ registry: "https://example.com/r" }, null, 4),
          "utf-8",
        );
        seedProjectAuthoringSkill(dir, "pr-to-video");
        expect(readFileSync(projectConfigPath(dir), "utf-8")).toContain('\n    "registry"');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("leaves a corrupt config untouched rather than clobbering it", () => {
      const dir = tmp();
      try {
        writeFileSync(projectConfigPath(dir), "{ not valid json", "utf-8");
        seedProjectAuthoringSkill(dir, "faceless-explainer");
        expect(readFileSync(projectConfigPath(dir), "utf-8")).toBe("{ not valid json");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
