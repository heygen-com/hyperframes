import { readFileSync, statSync } from "node:fs";
import { replaceFileAtomically } from "./atomicFile.js";
import {
  clearFileWriteReceipt,
  createWriteToken,
  fileContentVersion,
  recordFileWriteReceipt,
} from "./fileVersion.js";

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
  version: string;
  writeToken: string | null;
}

/** Applies prepared HTML mutations with the same receipt semantics as Studio; rolls back all on a failure. */
export function applyFileMutations(
  mutations: readonly FileMutationInput[],
  requestToken?: string,
  writeFile: (path: string, content: string, encoding: "utf-8") => void = (path, content) =>
    replaceFileAtomically(path, content, statSync(path).mode),
): AppliedFileMutation[] {
  const prepared = mutations.map((mutation) => ({
    ...mutation,
    before: mutation.before ?? readFileSync(mutation.absPath, "utf-8"),
  }));
  const results: AppliedFileMutation[] = [];
  const attempted: Array<PreparedMutation & { version: string; writeToken: string }> = [];
  try {
    for (const mutation of prepared) {
      results.push(applyOneMutation(mutation, requestToken, writeFile, attempted));
    }
    return results;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const mutation of attempted.reverse()) {
      try {
        writeFile(mutation.absPath, mutation.before, "utf-8");
        clearFileWriteReceipt(mutation.absPath, mutation.version, mutation.writeToken);
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
  mutation: PreparedMutation,
  requestToken: string | undefined,
  writeFile: (path: string, content: string, encoding: "utf-8") => void,
  attempted: Array<PreparedMutation & { version: string; writeToken: string }>,
): AppliedFileMutation {
  const current = readFileSync(mutation.absPath, "utf-8");
  assertExpectedVersion(mutation.expectedVersion, current);
  if (mutation.after === mutation.before) {
    return {
      ...mutation,
      before: current,
      changed: false,
      version: fileContentVersion(mutation.before),
      writeToken: null,
    };
  }
  const before = current;
  const version = fileContentVersion(mutation.after);
  const writeToken = createWriteToken(requestToken);
  attempted.push({ ...mutation, before, version, writeToken });
  writeFile(mutation.absPath, mutation.after, "utf-8");
  recordFileWriteReceipt(mutation.absPath, {
    path: mutation.sourceFile,
    version,
    writeToken,
  });
  return {
    ...mutation,
    before,
    changed: true,
    version,
    writeToken,
  };
}

function assertExpectedVersion(expectedVersion: string | undefined, current: string): void {
  if (expectedVersion !== undefined && fileContentVersion(current) !== expectedVersion) {
    throw new Error("file changed since the timeline was read");
  }
}
