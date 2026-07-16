import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

interface ProjectLink {
  projectId: string;
  url: string;
}

type ProjectLinks = Record<string, ProjectLink>;

const CONFIG_DIR = join(homedir(), ".hyperframes");
const PROJECTS_FILE = join(CONFIG_DIR, "projects.json");

/** Read + parse a JSON object file, or null if it's missing, unreadable, or not an object. */
function readJsonRecord(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isProjectLink(value: unknown): value is ProjectLink {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const link = value as Record<string, unknown>;
  return (
    typeof link.projectId === "string" && link.projectId.length > 0 && typeof link.url === "string"
  );
}

function readProjectLinks(): ProjectLinks {
  const record = readJsonRecord(PROJECTS_FILE);
  if (!record) return {};
  const links: ProjectLinks = {};
  for (const [path, value] of Object.entries(record)) {
    if (isProjectLink(value)) {
      links[path] = { projectId: value.projectId, url: value.url };
    }
  }
  return links;
}

function writeProjectLinks(links: ProjectLinks): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(PROJECTS_FILE, `${JSON.stringify(links, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // Project links must never prevent local CLI commands from running.
  }
}

export function readProjectLink(absDir: string): ProjectLink | null {
  return readProjectLinks()[resolve(absDir)] ?? null;
}

export function writeProjectLink(absDir: string, link: ProjectLink): void {
  const links = readProjectLinks();
  links[resolve(absDir)] = { projectId: link.projectId, url: link.url };
  writeProjectLinks(links);
}

export function ensureProjectId(absDir: string): string {
  const links = readProjectLinks();
  const path = resolve(absDir);
  const existing = links[path];
  if (existing) return existing.projectId;

  const projectId = randomUUID();
  links[path] = { projectId, url: "" };
  writeProjectLinks(links);
  return projectId;
}

// A committed, in-project descriptor so a whole team publishes to one shared link. Holds
// the project id and (for team spaces) the space id — never a secret; ownership is
// enforced server-side by the authenticated space's membership.
const TEAM_PROJECT_DIR = ".hyperframes";
const TEAM_PROJECT_FILE = "project.json";

export interface TeamProject {
  projectId: string;
  /** Shared team space id. Absent for a personal-space project (resolves per-user). */
  spaceId?: string;
}

function teamProjectPath(projectDir: string): string {
  return join(resolve(projectDir), TEAM_PROJECT_DIR, TEAM_PROJECT_FILE);
}

export function readTeamProject(projectDir: string): TeamProject | null {
  const record = readJsonRecord(teamProjectPath(projectDir));
  if (!record || typeof record.projectId !== "string" || record.projectId.length === 0) return null;
  const spaceId =
    typeof record.spaceId === "string" && record.spaceId.length > 0 ? record.spaceId : undefined;
  return { projectId: record.projectId, ...(spaceId ? { spaceId } : {}) };
}

/** Write the committed team descriptor and return its path (for a "commit this" hint). */
export function writeTeamProject(projectDir: string, team: TeamProject): string {
  const file = teamProjectPath(projectDir);
  const body: TeamProject = {
    projectId: team.projectId,
    ...(team.spaceId ? { spaceId: team.spaceId } : {}),
  };
  mkdirSync(join(resolve(projectDir), TEAM_PROJECT_DIR), { recursive: true });
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return file;
}
