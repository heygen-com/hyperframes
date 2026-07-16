import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Point the module's ~/.hyperframes config dir at a throwaway home so tests use real fs
// without touching the developer's actual home directory.
const osState = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => osState.home };
});

describe("projectLink", () => {
  let projectsPath: string;
  let projectDirs: string[];
  let ensureProjectId: typeof import("./projectLink.js").ensureProjectId;
  let readProjectLink: typeof import("./projectLink.js").readProjectLink;
  let writeProjectLink: typeof import("./projectLink.js").writeProjectLink;
  let readTeamProject: typeof import("./projectLink.js").readTeamProject;
  let writeTeamProject: typeof import("./projectLink.js").writeTeamProject;

  beforeEach(async () => {
    osState.home = mkdtempSync(join(tmpdir(), "hf-home-"));
    projectsPath = join(osState.home, ".hyperframes", "projects.json");
    projectDirs = [];
    vi.resetModules();
    ({ ensureProjectId, readProjectLink, writeProjectLink, readTeamProject, writeTeamProject } =
      await import("./projectLink.js"));
  });

  afterEach(() => {
    rmSync(osState.home, { recursive: true, force: true });
    for (const dir of projectDirs) rmSync(dir, { recursive: true, force: true });
  });

  function makeProjectDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "hf-proj-"));
    projectDirs.push(dir);
    return dir;
  }

  it("mints one project id per directory and reuses it", () => {
    const first = makeProjectDir();
    const second = makeProjectDir();
    const firstId = ensureProjectId(first);

    expect(ensureProjectId(first)).toBe(firstId);
    expect(ensureProjectId(second)).not.toBe(firstId);
  });

  it("round-trips a project link", () => {
    const dir = makeProjectDir();
    const link = { projectId: "hfp_123", url: "https://hyperframes.dev/p/hfp_123" };

    writeProjectLink(dir, link);

    expect(readProjectLink(dir)).toEqual(link);
  });

  it("persists only the project id and URL", () => {
    const dir = makeProjectDir();
    const link = { projectId: "hfp_123", url: "https://hyperframes.dev/p/hfp_123", secret: "nope" };

    writeProjectLink(dir, link);

    expect(readFileSync(projectsPath, "utf-8")).not.toContain("nope");
  });

  it("treats a missing projects file as empty and creates it on ensure", () => {
    const dir = makeProjectDir();
    expect(readProjectLink(dir)).toBeNull();

    const projectId = ensureProjectId(dir);

    expect(projectId).toBeTruthy();
    expect(readProjectLink(dir)).toEqual({ projectId, url: "" });
  });

  it("treats corrupt JSON as empty and rewrites it on ensure", () => {
    const dir = makeProjectDir();
    writeProjectLink(dir, { projectId: "x", url: "y" });
    writeFileSync(projectsPath, "{not valid json", "utf-8");
    expect(readProjectLink(dir)).toBeNull();

    const projectId = ensureProjectId(dir);

    expect(readProjectLink(dir)).toEqual({ projectId, url: "" });
    expect(() => JSON.parse(readFileSync(projectsPath, "utf-8"))).not.toThrow();
  });

  it("uses the resolved directory as the storage key", () => {
    const dir = makeProjectDir();
    const projectId = ensureProjectId(dir);

    expect(ensureProjectId(resolve(dir))).toBe(projectId);
    expect(Object.keys(JSON.parse(readFileSync(projectsPath, "utf-8")))).toEqual([resolve(dir)]);
  });

  it("reads and writes a committed team project (id + optional space)", () => {
    const dir = makeProjectDir();
    expect(readTeamProject(dir)).toBeNull();

    // Personal-space project: id only, no spaceId key.
    const soloFile = writeTeamProject(dir, { projectId: "hfp_solo" });
    expect(readTeamProject(dir)).toEqual({ projectId: "hfp_solo" });
    const soloBody = readFileSync(soloFile, "utf-8");
    expect(soloBody).not.toContain("spaceId");
    // Never a secret.
    expect(soloBody).not.toContain("token");

    // Team-space project: id + shared space id round-trip.
    writeTeamProject(dir, { projectId: "hfp_team", spaceId: "space-42" });
    expect(readTeamProject(dir)).toEqual({ projectId: "hfp_team", spaceId: "space-42" });
  });
});
