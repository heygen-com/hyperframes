import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { realFilePath } from "@hyperframes/studio-server/safe-path";
import { terminalText } from "@hyperframes/core/terminal-text";
import * as clack from "../ui/prompts.js";
import { hyperframesConfigDir } from "./configDir.js";
import {
  type OnOutsideFile,
  type OutsideFileReference,
  outsideFilesQuestion,
} from "./leftOutReference.js";

/** Outside files a person approved, per project folder. Kept in the CLI's config folder, never in a project. */
const approvalsFile = () => hyperframesConfigDir("outside-files.json");

type Approvals = Record<string, unknown>;

function readApprovals(): Approvals {
  try {
    const parsed: unknown = JSON.parse(readFileSync(approvalsFile(), "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Approvals)
      : {};
  } catch {
    // expected: no approvals yet, or a file that cannot be read, which approves nothing
    return {};
  }
}

const projectKey = (projectDir: string) => realFilePath(resolve(projectDir));

export function approvedOutsideFiles(projectDir: string): Set<string> {
  const listed = readApprovals()[projectKey(projectDir)];
  return new Set(Array.isArray(listed) ? listed.map(String) : []);
}

function rememberOutsideFiles(projectDir: string, paths: Iterable<string>): void {
  const approvals = readApprovals();
  const key = projectKey(projectDir);
  approvals[key] = [...new Set([...approvedOutsideFiles(projectDir), ...paths])].sort();
  const file = approvalsFile();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const staging = `${file}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(approvals, null, 2)}\n`, { mode: 0o600 });
  renameSync(staging, file);
}

export async function confirmOutsideFiles(references: OutsideFileReference[]): Promise<boolean> {
  const answer = await clack.confirm({
    message: outsideFilesQuestion(references),
    initialValue: false,
  });
  return answer === true;
}

export interface OutsideFileChoice {
  /** `--include-outside-files`: every outside file goes, approved or not. */
  includeAll: boolean;
  /** Asks a person about the files not yet approved; absent when nobody can answer. */
  ask?: (references: OutsideFileReference[]) => Promise<boolean>;
}

/**
 * Runs `stage` with outside files left out unless approved for this project or `includeAll`, and returns what it
 * staged with the outside files it copied. When `ask` approves the rest, they are remembered and `stage` runs again.
 */
export async function stageWithOutsideFileApproval<T>(
  projectDir: string,
  choice: OutsideFileChoice,
  stage: (onOutsideFile: OnOutsideFile) => T,
): Promise<{ staged: T; outsideFiles: OutsideFileReference[] }> {
  const approved = approvedOutsideFiles(projectDir);
  const run = () => {
    const outsideFiles: OutsideFileReference[] = [];
    const notApproved = new Map<string, OutsideFileReference>();
    const staged = stage((reference) => {
      if (!choice.includeAll && !approved.has(reference.path)) {
        notApproved.set(reference.path, reference);
        return false;
      }
      outsideFiles.push(reference);
      return true;
    });
    return { staged, outsideFiles, notApproved: [...notApproved.values()] };
  };
  const first = run();
  if (first.notApproved.length === 0 || !choice.ask || !(await choice.ask(first.notApproved)))
    return first;
  const paths = first.notApproved.map((reference) => reference.path);
  for (const path of paths) approved.add(path);
  try {
    rememberOutsideFiles(projectDir, paths);
  } catch (error) {
    clack.log.warn(
      `Could not remember the approval for next time: ${terminalText((error as Error).message)}`,
    );
  }
  return run();
}
