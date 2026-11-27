import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CliRuntimeError } from "./commandResult.js";
import { hyperframesConfigDir, seededConfigFile } from "./configDir.js";
import { readRecord, recordKind, writeRecord } from "./projectRecords.js";

interface ProjectLink {
  projectId: string;
  url: string;
  spaceId?: string;
}

export const PERSONAL_SPACE = "";

type ProjectLinks = Record<string, ProjectLink>;

const configDir = () => hyperframesConfigDir();
const projectsFile = () => seededConfigFile("projects.json");

/** Parse a JSON object, or null if it's not valid JSON or not an object. */
function jsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readJsonRecord(path: string): Record<string, unknown> | null {
  try {
    return existsSync(path) ? jsonObject(readFileSync(path, "utf-8")) : null;
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

function projectLinkRecord(link: ProjectLink): ProjectLink {
  return {
    projectId: link.projectId,
    url: link.url,
    ...(typeof link.spaceId === "string" ? { spaceId: link.spaceId } : {}),
  };
}

function readProjectLinks(): ProjectLinks {
  const record = readJsonRecord(projectsFile());
  if (!record) return {};
  const links: ProjectLinks = {};
  for (const [path, value] of Object.entries(record)) {
    if (isProjectLink(value)) {
      links[path] = projectLinkRecord(value);
    }
  }
  return links;
}

function writeProjectLinks(links: ProjectLinks): void {
  try {
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(projectsFile(), `${JSON.stringify(links, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // Project links must never prevent local CLI commands from running.
  }
}

export function readProjectLink(absDir: string): ProjectLink | null {
  return readProjectLinks()[resolve(absDir)] ?? null;
}

export function writeProjectLink(absDir: string, link: ProjectLink): void {
  const links = readProjectLinks();
  links[resolve(absDir)] = projectLinkRecord(link);
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

const MAX_TEAM_PROJECT_BYTES = 64 * 1024;

export function readTeamProject(projectDir: string): TeamProject | null {
  const kind = recordKind(resolve(projectDir), TEAM_PROJECT_FILE);
  if (kind === "absent") return null;
  if (kind === "other")
    throw new CliRuntimeError(
      `${teamProjectPath(projectDir)} is a link or not a plain file, or ${TEAM_PROJECT_DIR} is not a real folder. Remove it and publish again.`,
    );
  const record = jsonObject(
    readRecord(resolve(projectDir), TEAM_PROJECT_FILE, MAX_TEAM_PROJECT_BYTES),
  );
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
  if (!writeRecord(resolve(projectDir), TEAM_PROJECT_FILE, `${JSON.stringify(body, null, 2)}\n`))
    throw new Error(`Could not write ${file}`);
  return file;
}

export function teamProjectLinkedHere(projectDir: string, team: TeamProject): boolean {
  const link = readProjectLink(projectDir);
  if (!link || link.projectId !== team.projectId) return false;
  const recordPredatesSpaces = link.spaceId === undefined;
  return recordPredatesSpaces || link.spaceId === (team.spaceId ?? PERSONAL_SPACE);
}
