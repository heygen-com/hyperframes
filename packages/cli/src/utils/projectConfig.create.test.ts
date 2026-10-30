import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProjectConfig,
  DEFAULT_PROJECT_CONFIG,
  projectConfigPath,
  seedProjectAuthoringSkill,
  writeProjectConfig,
} from "./projectConfig.js";

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return {
    ...original,
    readFileSync: vi.fn(original.readFileSync),
    linkSync: vi.fn(original.linkSync),
  };
});

const dirs: string[] = [];
function project() {
  const dir = fs.mkdtempSync(join(tmpdir(), "hf-config-create-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    expect(fs.readdirSync(dir).filter((name) => name.startsWith(".hf-create-"))).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("project config creation", () => {
  it("preserves existing bytes on create and still permits intentional updates", () => {
    const dir = project();
    const path = projectConfigPath(dir);
    createProjectConfig(dir);
    expect(fs.readFileSync(path, "utf-8")).toBe(
      JSON.stringify(DEFAULT_PROJECT_CONFIG, null, 2) + "\n",
    );
    const updated = { ...DEFAULT_PROJECT_CONFIG, authoringSkill: "slideshow" };
    createProjectConfig(dir, updated);
    expect(JSON.parse(fs.readFileSync(path, "utf-8"))).toEqual(DEFAULT_PROJECT_CONFIG);
    writeProjectConfig(dir, updated);
    expect(JSON.parse(fs.readFileSync(path, "utf-8"))).toEqual(updated);
  });

  it("creates the config on a volume or sandbox that refuses hard links (EPERM)", () => {
    const dir = project();
    vi.mocked(fs.linkSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    });
    createProjectConfig(dir);
    expect(JSON.parse(fs.readFileSync(projectConfigPath(dir), "utf-8"))).toEqual(
      DEFAULT_PROJECT_CONFIG,
    );
    expect(fs.readdirSync(dir)).toEqual(["hyperframes.json"]);
  });

  it("preserves a config created after the skill seed reads ENOENT", () => {
    const dir = project();
    const path = projectConfigPath(dir);
    const winner = '{"registry":"https://custom.example","authoringSkill":"slideshow"}\n';
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
      fs.writeFileSync(path, winner);
      throw Object.assign(new Error("missing before concurrent creation"), { code: "ENOENT" });
    });
    seedProjectAuthoringSkill(dir, "product-launch-video");
    expect(fs.readFileSync(path, "utf-8")).toBe(winner);
  });

  it("does not create a dangling symlink target when seeding an absent config", () => {
    const dir = project();
    const target = join(dir, "missing.json");
    fs.symlinkSync(target, projectConfigPath(dir));
    seedProjectAuthoringSkill(dir, "slideshow");
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.lstatSync(projectConfigPath(dir)).isSymbolicLink()).toBe(true);
  });
});
