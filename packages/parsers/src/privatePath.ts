import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

function realpath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch (error) {
    // Some Windows volumes (RAM disks) refuse the native call with EISDIR.
    if ((error as NodeJS.ErrnoException).code === "EISDIR") return realpathSync(path);
    throw error;
  }
}

/**
 * Segments as a case-insensitive file system or Windows opens them: any case or Unicode form (a long s, a ligature or a
 * full-width letter reads as its plain letters, an invisible character is dropped), no trailing dots or spaces, no
 * `:stream` suffix.
 */
export function projectPathSegments(relPath: string): string[] {
  return relPath
    .normalize("NFKC")
    .toUpperCase()
    .toLowerCase()
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
    .split(/[\\/]/)
    .map((segment) => withoutTrailingDotsOrSpaces(segment.split(":", 1)[0] ?? ""));
}

function withoutTrailingDotsOrSpaces(segment: string): string {
  let end = segment.length;
  while (end > 0 && (segment[end - 1] === "." || segment[end - 1] === " ")) end--;
  return segment.slice(0, end);
}

// Git metadata and env files hold commands other tools run and secrets: nothing serves or inlines them.
export function isVcsOrSecretPath(relPath: string): boolean {
  return projectPathSegments(relPath).some(
    (segment) => segment === ".git" || segment.startsWith(".env"),
  );
}

// `.hyperframes/` holds the desktop app's and the CLI's own records (a hand-off, chat history, read marks): no file
// server serves any of it, the folder itself included, but Studio's own files and the assets compositions load. Studio
// reads and writes those only in the project's own `.hyperframes/`, so one in a subfolder holds records only.
const STUDIO_FILES = new Set([
  ".hyperframes/studio-motion.json",
  ".hyperframes/studio-manual-edits.json",
]);
const STUDIO_FOLDERS = [".hyperframes/prepared-assets", ".hyperframes/requests"];
const UNCONVERTED_PREVIEW_DOWNLOADS = ".hyperframes/prepared-assets/downloads";

// Credentials and coding-tool state that projects often sit next to: registry tokens, MCP and agent settings, cloud and
// SSH keys. No composition loads one, so no file server serves one and no upload ships one.
const CREDENTIAL_FILES = new Set([
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".pypirc",
  "pip.conf",
  "pip.ini",
  ".netrc",
  "_netrc",
  ".git-credentials",
  ".gitconfig",
  ".mcp.json",
  "credentials.json",
  "serviceaccountkey.json",
  "service-account.json",
  "service_account.json",
]);
const CREDENTIAL_FOLDERS = new Set([
  ".ssh",
  ".aws",
  ".gnupg",
  ".docker",
  ".kube",
  ".azure",
  ".claude",
  ".codex",
  ".cursor",
  ".agents",
  ".gemini",
  ".vscode",
  ".idea",
]);
const CREDENTIAL_CONFIG_FOLDERS = new Set(["gcloud", "gh"]);
const KEY_FILE =
  /^(?:id_(?:rsa|dsa|ecdsa|ed25519).*|.*\.(?:pem|key|p12|pfx|p8|ppk|jks|keystore|kdbx))$/;
const SECRET_STORE_FILE = /\.(?:tfstate(?:\.backup)?|tfvars(?:\.json)?)$/;

/** Credential files and tool or agent state, for a project-relative path in any spelling Windows opens. */
export function isCredentialOrToolStatePath(relPath: string): boolean {
  const segments = projectPathSegments(relPath);
  const name = segments.at(-1) ?? "";
  return (
    CREDENTIAL_FILES.has(name) ||
    KEY_FILE.test(name) ||
    SECRET_STORE_FILE.test(name) ||
    segments.some(
      (segment, at) =>
        CREDENTIAL_FOLDERS.has(segment) ||
        (segment === ".config" && CREDENTIAL_CONFIG_FOLDERS.has(segments[at + 1] ?? "")),
    )
  );
}

/** Files no composition loads, in any spelling Windows opens: git, env, credentials, tool state, app records. */
export function isStudioPrivatePath(relPath: string): boolean {
  if (isVcsOrSecretPath(relPath) || isCredentialOrToolStatePath(relPath)) return true;
  const segments = projectPathSegments(relPath);
  const inside = !isAbsolute(relPath) && !/^\.\.[. ]*$/.test(relPath.split(/[\\/]/, 1)[0] ?? "");
  const name = segments.at(-1) ?? "";
  const loadedType = !name.startsWith(".") && LOADED_ASSET_TYPE.test(name);
  const firstNamed = segments.findIndex((segment) => segment !== "");
  return segments.some((segment, at) => {
    const atRoot = firstNamed === -1 || at <= firstNamed;
    if (segment === ".hyperframes")
      return !atRoot || !isStudioOwnFile(segments.slice(at).join("/"));
    if (BUILD_OUTPUT_FOLDERS.has(segment)) return inside;
    const mediaFolder = atRoot && segment === MEDIA_FOLDER;
    return inside && segment.startsWith(".") && !mediaFolder && !loadedType;
  });
}

// A new tool keeps its token under a new hidden name, so a hidden file is private, and a file in a hidden folder is
// private unless it is in the media folder or is an asset a page loads. A path leaving the project is judged elsewhere.
const MEDIA_FOLDER = ".media";
// Framework build output: its scripts can carry server environment values inlined at build time.
const BUILD_OUTPUT_FOLDERS = new Set([
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".vercel",
  ".netlify",
  ".wrangler",
  ".astro",
  ".turbo",
]);
const LOADED_ASSET_TYPE =
  /.\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|heic|heif|mp4|m4v|mov|webm|mkv|mxf|avi|mp3|wav|m4a|aac|ogg|oga|opus|flac|woff2?|ttf|otf|css|m?js|cjs)$/;

function isStudioOwnFile(path: string): boolean {
  if (
    path === UNCONVERTED_PREVIEW_DOWNLOADS ||
    path.startsWith(`${UNCONVERTED_PREVIEW_DOWNLOADS}/`)
  )
    return false;
  return (
    STUDIO_FILES.has(path) ||
    STUDIO_FOLDERS.some((folder) => path === folder || path.startsWith(`${folder}/`))
  );
}

/** Whether `isPrivate` holds for a file under `projectDir`, spelled as given or with its links resolved. */
export function isPrivateFileUnder(
  projectDir: string,
  filePath: string,
  isPrivate: (relPath: string) => boolean,
): boolean {
  const rel = (from: string, to: string) => relative(from, to).split(sep).join("/");
  if (isPrivate(rel(resolve(projectDir), resolve(filePath)))) return true;
  try {
    return isPrivate(rel(realpath(resolve(projectDir)), realpath(filePath)));
  } catch {
    return false;
  }
}
