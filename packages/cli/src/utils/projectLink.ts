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

function isProjectLink(value: unknown): value is ProjectLink {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const link = value as Record<string, unknown>;
  return (
    typeof link.projectId === "string" && link.projectId.length > 0 && typeof link.url === "string"
  );
}

function readProjectLinks(): ProjectLinks {
  try {
    if (!existsSync(PROJECTS_FILE)) return {};
    const parsed: unknown = JSON.parse(readFileSync(PROJECTS_FILE, "utf-8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

    const links: ProjectLinks = {};
    for (const [path, value] of Object.entries(parsed)) {
      if (isProjectLink(value)) {
        links[path] = { projectId: value.projectId, url: value.url };
      }
    }
    return links;
  } catch {
    return {};
  }
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

// A committed, in-project id so a whole team publishes to one shared link. Holds the id
// only — never a secret; ownership is enforced server-side by the authenticated space.
const TEAM_PROJECT_DIR = ".hyperframes";
const TEAM_PROJECT_FILE = "project.json";

function teamProjectPath(projectDir: string): string {
  return join(resolve(projectDir), TEAM_PROJECT_DIR, TEAM_PROJECT_FILE);
}

export function readTeamProjectId(projectDir: string): string | null {
  try {
    const file = teamProjectPath(projectDir);
    if (!existsSync(file)) return null;
    const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const id = (parsed as Record<string, unknown>).projectId;
      if (typeof id === "string" && id.length > 0) return id;
    }
    return null;
  } catch {
    return null;
  }
}

/** Write the committed team id file and return its path (for a "commit this" hint). */
export function writeTeamProjectId(projectDir: string, projectId: string): string {
  const file = teamProjectPath(projectDir);
  mkdirSync(join(resolve(projectDir), TEAM_PROJECT_DIR), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ projectId }, null, 2)}\n`);
  return file;
}
