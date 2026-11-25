import { readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  isCredentialOrToolStatePath,
  isStudioPrivatePath,
  isVcsOrSecretPath,
  projectPathSegments,
} from "../parsers/src/privatePath";

export interface DevServedRoots {
  /** The Vite root: Studio's own package, with linked projects under `data/projects`. */
  studio: string;
  /** The source checkout Vite serves under `/@fs/`. */
  checkout: string;
}

const inside = (rel: string) => rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);

function realOrSelf(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

function linkedProjects(studio: string): string[] {
  const dir = join(studio, "data", "projects");
  try {
    return readdirSync(dir).map((name) => realOrSelf(join(dir, name)));
  } catch {
    return [];
  }
}

// `/@fs/` names a file-system path; any other URL Vite may read from its root or, as an id, from the file system.
function filesNamedBy(url: string, studio: string): string[] | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, "http://dev").pathname);
  } catch {
    return null;
  }
  if (pathname.startsWith("/@fs/")) return [resolve("/", pathname.slice("/@fs/".length))];
  const path = pathname.replace(/^\/@id(?=\/)/, "");
  return [resolve(studio, `.${path}`), resolve("/", path.replace(/^\/+/, ""))];
}

function refused(file: string, roots: DevServedRoots, projects: string[]): boolean {
  if (projectPathSegments(relative(roots.studio, file))[0] === "data") return true;
  if (projects.some((project) => project === file || inside(relative(project, file)))) return true;
  const rel = relative(roots.checkout, file).split("\\").join("/");
  if (!projectPathSegments(rel).includes("node_modules")) return isStudioPrivatePath(rel);
  return isVcsOrSecretPath(rel) || isCredentialOrToolStatePath(rel);
}

/** Whether the dev server may answer `url` from a file: never a project's, `data/`'s, or a private one. */
export function devServesUrl(url: string, roots: DevServedRoots): boolean {
  const files = filesNamedBy(url, roots.studio);
  if (!files) return false;
  const projects = linkedProjects(roots.studio);
  return !files.some(
    (file) => refused(file, roots, projects) || refused(realOrSelf(file), roots, projects),
  );
}
