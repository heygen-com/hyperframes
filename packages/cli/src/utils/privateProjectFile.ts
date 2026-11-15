import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  isEnvOrGitPath,
  isPrivateOutsideFile,
  linksOutside,
} from "@hyperframes/studio-server/outside-file";
import { isPrivateProjectFile, realFilePath } from "@hyperframes/studio-server/safe-path";

export { isEnvOrGitPath, isPrivateOutsideFile, linksOutside };

export function linksToPrivateOutsideFile(projectDir: string, filePath: string): boolean {
  return linksOutside(projectDir, filePath) && isPrivateOutsideFile(projectDir, filePath);
}

const RECEIVED_RECORD = join(".hyperframes", "received-files.json");

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

function listedUnder(record: ReceivedRecord): string[] {
  const prefix = record.projectDirFromRoot ? `${record.projectDirFromRoot}/`.normalize("NFC") : "";
  return (record.listed as unknown[])
    .map(String)
    .filter((entry) => entry.normalize("NFC").startsWith(prefix))
    .map((entry) => join(record.root, entry));
}

export function receivedRecordStatus(
  projectDir: string,
): { path: string; listed: string[] | null } | null {
  const records = receivedRecordsAtOrAbove(projectDir);
  const [nearest] = records;
  if (!nearest) return null;
  const unreadable = records.find((record) => !Array.isArray(record.listed));
  if (unreadable) return { path: join(unreadable.root, RECEIVED_RECORD), listed: null };
  return { path: join(nearest.root, RECEIVED_RECORD), listed: records.flatMap(listedUnder) };
}

/** Project files no composition loads, so none is served or uploaded for one: env files, Git data, tool records. */
export function isPrivateCompositionFile(projectDir: string, filePath: string): boolean {
  return (
    isEnvOrGitPath(relative(projectDir, filePath)) ||
    isEnvOrGitPath(relative(realFilePath(projectDir), realFilePath(filePath))) ||
    isPrivateProjectFile(projectDir, filePath)
  );
}
