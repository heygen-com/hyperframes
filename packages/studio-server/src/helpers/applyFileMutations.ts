import { readFileSync, writeFileSync } from "node:fs";
import { backupPathForResponse, snapshotBeforeWrite } from "./backupJournal.js";
import { createWriteToken, fileContentVersion, recordFileWriteReceipt } from "./fileVersion.js";

export interface FileMutationInput {
  sourceFile: string;
  absPath: string;
  before?: string;
  after: string;
  expectedVersion?: string;
}

export interface AppliedFileMutation {
  sourceFile: string;
  changed: boolean;
  before: string;
  after: string;
  backupPath: string | null;
  version: string;
  writeToken: string | null;
}

/** Applies prepared HTML mutations with the same journal and receipt semantics as Studio. */
export function applyFileMutations(
  projectDir: string,
  mutations: readonly FileMutationInput[],
  requestToken?: string,
  writeFile: (path: string, content: string, encoding: "utf-8") => void = writeFileSync,
): AppliedFileMutation[] {
  const prepared = mutations.map((mutation) => ({
    ...mutation,
    before: mutation.before ?? readFileSync(mutation.absPath, "utf-8"),
  }));
  const results: AppliedFileMutation[] = [];
  const attempted: typeof prepared = [];
  try {
    for (const mutation of prepared) {
      results.push(applyOneMutation(projectDir, mutation, requestToken, writeFile, attempted));
    }
    return results;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const mutation of attempted.reverse()) {
      try {
        writeFile(mutation.absPath, mutation.before, "utf-8");
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "File mutation failed and rollback did not complete",
      );
    }
    throw error;
  }
}

type PreparedMutation = FileMutationInput & { before: string };

function applyOneMutation(
  projectDir: string,
  mutation: PreparedMutation,
  requestToken: string | undefined,
  writeFile: (path: string, content: string, encoding: "utf-8") => void,
  attempted: PreparedMutation[],
): AppliedFileMutation {
  const current = readFileSync(mutation.absPath, "utf-8");
  assertExpectedVersion(mutation.expectedVersion, current);
  if (mutation.after === mutation.before) {
    return {
      ...mutation,
      before: current,
      changed: false,
      backupPath: null,
      version: fileContentVersion(mutation.before),
      writeToken: null,
    };
  }
  const backup = snapshotBeforeWrite(projectDir, mutation.absPath);
  if (backup.error) throw new Error(`backup failed: ${backup.error}`);
  const before = current;
  attempted.push({ ...mutation, before });
  writeFile(mutation.absPath, mutation.after, "utf-8");
  const version = fileContentVersion(mutation.after);
  const writeToken = createWriteToken(requestToken);
  recordFileWriteReceipt(mutation.absPath, {
    path: mutation.sourceFile,
    version,
    writeToken,
  });
  return {
    ...mutation,
    before,
    changed: true,
    backupPath: backupPathForResponse(projectDir, backup.backupPath),
    version,
    writeToken,
  };
}

function assertExpectedVersion(expectedVersion: string | undefined, current: string): void {
  if (expectedVersion !== undefined && fileContentVersion(current) !== expectedVersion) {
    throw new Error("file changed since the timeline was read");
  }
}
