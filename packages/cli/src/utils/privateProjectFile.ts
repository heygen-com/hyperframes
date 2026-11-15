import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  isEnvOrGitPath,
  isPrivateOutsideFile,
  linksOutside,
} from "@hyperframes/studio-server/outside-file";
import { isPrivateProjectFile, realFilePath } from "@hyperframes/studio-server/safe-path";
import { mkdirWithinProject } from "@hyperframes/core";
import { projectPathSegments } from "@hyperframes/core/safe-path";
import { publishRegistryFile, registryRoot, registryTargetPath } from "../registry/publication.js";

export { isEnvOrGitPath, isPrivateOutsideFile, linksOutside };

export function linksToPrivateOutsideFile(projectDir: string, filePath: string): boolean {
  return linksOutside(projectDir, filePath) && isPrivateOutsideFile(projectDir, filePath);
}

const RECEIVED_RECORD = join(".hyperframes", "received-files.json");
const RECEIVED_RECORD_LOCK = `${RECEIVED_RECORD}.lock`;
const LOCK_WAIT_MS = 2_000;
const LOCK_STALE_MS = 10_000;

interface ReceivedRecord {
  root: string;
  projectDirFromRoot: string;
  listed: unknown;
}

function recordFileAt(dir: string): boolean {
  try {
    return statSync(join(dir, RECEIVED_RECORD)).isFile();
  } catch {
    return false;
  }
}

function readRecord(dir: string, ownFolder: boolean): { listed: unknown } | null {
  if (!ownFolder && !recordFileAt(dir)) return null;
  try {
    return { listed: JSON.parse(readFileSync(join(dir, RECEIVED_RECORD), "utf-8")).files };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return ownFolder && (code === "ENOENT" || code === "ENOTDIR") ? null : { listed: undefined };
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function takeRecordLock(lock: string): void {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      closeSync(openSync(lock, "wx"));
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const heldFor = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
    if (heldFor > LOCK_STALE_MS) rmSync(lock, { force: true });
    else if (Date.now() < deadline) sleepSync(25);
    else throw new Error(`Another program is changing ${RECEIVED_RECORD}; try again.`);
  }
}

function changeReceivedRecord(projectDir: string, change: (files: Set<string>) => boolean): void {
  const root = registryRoot(projectDir);
  const lock = registryTargetPath(root, RECEIVED_RECORD_LOCK);
  mkdirWithinProject(root, dirname(lock));
  takeRecordLock(lock);
  try {
    const record = readRecord(root, true);
    if (record && !Array.isArray(record.listed)) return;
    const files = new Set(((record?.listed ?? []) as unknown[]).map(String));
    if (!change(files)) return;
    publishRegistryFile(root, RECEIVED_RECORD, `${JSON.stringify({ files: [...files].sort() })}\n`);
  } finally {
    rmSync(lock, { force: true });
  }
}

export function recordReceivedFiles(root: string, paths: string[]): string[] {
  const added: string[] = [];
  if (paths.length === 0) return added;
  changeReceivedRecord(root, (files) => {
    for (const path of paths.map((one) => one.normalize("NFC"))) {
      if (!files.has(path)) added.push(path);
      files.add(path);
    }
    return added.length > 0;
  });
  return added;
}

export function forgetReceivedFiles(root: string, paths: string[]): void {
  if (paths.length === 0) return;
  changeReceivedRecord(root, (files) => paths.map((path) => files.delete(path)).some(Boolean));
}

function receivedRecordsAtOrAbove(projectDir: string): ReceivedRecord[] {
  let start: string;
  try {
    start = realpathSync(projectDir);
  } catch {
    start = resolve(projectDir);
  }
  const records: ReceivedRecord[] = [];
  for (let dir = start; ; ) {
    const record = readRecord(dir, dir === start);
    if (record)
      records.push({
        root: dir,
        projectDirFromRoot: relative(dir, start).split(sep).join("/"),
        ...record,
      });
    const parent = dirname(dir);
    if (parent === dir) return records;
    dir = parent;
  }
}

function fileIdentity(path: string): string | null {
  try {
    const stat = lstatSync(path, { bigint: true });
    return stat.ino === 0n ? null : `${stat.dev}:${stat.ino}`;
  } catch {
    return null;
  }
}

function listedIn(record: ReceivedRecord, projectDir: string): (path: string) => boolean {
  const listed = (record.listed as unknown[]).map((path) => String(path).normalize("NFC"));
  const files = new Set(listed);
  const keyOf = (path: string) =>
    (record.projectDirFromRoot ? `${record.projectDirFromRoot}/${path}` : path).normalize("NFC");
  let listedOnDisk: Set<string> | undefined;
  const sameFileAsListed = (path: string) => {
    listedOnDisk ??= new Set(
      listed.flatMap((entry) => fileIdentity(join(record.root, entry)) ?? []),
    );
    const identity = fileIdentity(join(projectDir, path));
    return identity !== null && listedOnDisk.has(identity);
  };
  return (path) => files.has(keyOf(path)) || sameFileAsListed(path);
}

export function receivedFiles(projectDir: string): (path: string) => boolean {
  const records = receivedRecordsAtOrAbove(projectDir);
  if (records.some((record) => !Array.isArray(record.listed))) return () => true;
  const listedInAnyRecord = records.map((record) => listedIn(record, projectDir));
  return (path) => listedInAnyRecord.some((listed) => listed(path));
}

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
const KEY_FILE = /^(?:id_(?:rsa|dsa|ecdsa|ed25519).*|.*\.(?:pem|key|p12|pfx))$/;

export function isCredentialOrToolStatePath(relPath: string): boolean {
  const segments = projectPathSegments(relPath);
  const name = segments.at(-1) ?? "";
  return (
    CREDENTIAL_FILES.has(name) ||
    KEY_FILE.test(name) ||
    segments.some(
      (segment, at) =>
        CREDENTIAL_FOLDERS.has(segment) ||
        (segment === ".config" && CREDENTIAL_CONFIG_FOLDERS.has(segments[at + 1] ?? "")),
    )
  );
}

const leavesProject = (path: string): boolean =>
  isAbsolute(path) || path.split(/[\\/]/)[0] === "..";

const projectRelatives = (projectDir: string, filePath: string): string[] => [
  relative(projectDir, filePath),
  relative(realFilePath(projectDir), realFilePath(filePath)),
];

/** Project files no composition loads, so none is served or uploaded: env, Git, credentials, tool and agent state. */
export function isPrivateCompositionFile(projectDir: string, filePath: string): boolean {
  const paths = projectRelatives(projectDir, filePath);
  return (
    paths.some(isEnvOrGitPath) ||
    paths.some((path) => !leavesProject(path) && isCredentialOrToolStatePath(path)) ||
    isPrivateProjectFile(projectDir, filePath)
  );
}

export function isHiddenProjectFile(projectDir: string, filePath: string): boolean {
  return projectRelatives(projectDir, filePath).some((path) =>
    path.split(/[\\/]/).some((segment) => segment.startsWith(".") && segment !== ".."),
  );
}
