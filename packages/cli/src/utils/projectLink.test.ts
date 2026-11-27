import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
  let teamProjectLinkedHere: typeof import("./projectLink.js").teamProjectLinkedHere;

  beforeEach(async () => {
    osState.home = mkdtempSync(join(tmpdir(), "hf-home-"));
    projectsPath = join(osState.home, ".hyperframes", "projects.json");
    projectDirs = [];
    vi.resetModules();
    ({
      ensureProjectId,
      readProjectLink,
      writeProjectLink,
      readTeamProject,
      writeTeamProject,
      teamProjectLinkedHere,
    } = await import("./projectLink.js"));
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

  it("refuses a team descriptor that is a link, and replaces the link rather than writing through it", () => {
    const dir = makeProjectDir();
    const victim = join(makeProjectDir(), ".bashrc");
    writeFileSync(victim, "victim bytes\n");
    mkdirSync(join(dir, ".hyperframes"));
    const descriptor = join(dir, ".hyperframes", "project.json");
    symlinkSync(victim, descriptor);

    expect(() => readTeamProject(dir)).toThrow(/is a link or not a plain file/);
    writeTeamProject(dir, { projectId: "hfp_new" });

    expect(readFileSync(victim, "utf-8")).toBe("victim bytes\n");
    expect(lstatSync(descriptor).isFile()).toBe(true);
    expect(readTeamProject(dir)).toEqual({ projectId: "hfp_new" });
  });

  it("refuses to read or write the team descriptor through a linked .hyperframes folder", () => {
    const dir = makeProjectDir();
    const outside = makeProjectDir();
    const victim = join(outside, "project.json");
    writeFileSync(victim, "victim bytes\n");
    symlinkSync(outside, join(dir, ".hyperframes"));

    expect(() => readTeamProject(dir)).toThrow(/is a link or not a plain file/);
    expect(() => writeTeamProject(dir, { projectId: "hfp_new" })).toThrow(/Could not write/);
    expect(readFileSync(victim, "utf-8")).toBe("victim bytes\n");
  });

  it("keeps the published space in the link record", () => {
    const dir = makeProjectDir();
    writeProjectLink(dir, { projectId: "hfp_1", url: "u", spaceId: "space-1" });
    expect(readProjectLink(dir)).toEqual({ projectId: "hfp_1", url: "u", spaceId: "space-1" });
  });

  it("links a team descriptor only when this machine's record names its project and space", () => {
    const dir = makeProjectDir();
    const team = { projectId: "hfp_team", spaceId: "space-42" };

    // A descriptor that came with the folder, and nothing on this machine.
    expect(teamProjectLinkedHere(dir, team)).toBe(false);

    writeProjectLink(dir, { projectId: "hfp_other", url: "u", spaceId: "space-42" });
    expect(teamProjectLinkedHere(dir, team)).toBe(false);

    writeProjectLink(dir, { projectId: "hfp_team", url: "u", spaceId: "" });
    expect(teamProjectLinkedHere(dir, team)).toBe(false);

    writeProjectLink(dir, { projectId: "hfp_team", url: "u", spaceId: "space-42" });
    expect(teamProjectLinkedHere(dir, team)).toBe(true);
    expect(teamProjectLinkedHere(makeProjectDir(), team)).toBe(false);

    // A record from before the space was kept still links its own project.
    writeProjectLink(dir, { projectId: "hfp_team", url: "u" });
    expect(teamProjectLinkedHere(dir, team)).toBe(true);
    expect(teamProjectLinkedHere(dir, { projectId: "hfp_team" })).toBe(true);
  });
});
