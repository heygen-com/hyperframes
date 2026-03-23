import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { lintHyperframeHtml, type HyperframeLintResult } from "@hyperframes/core/lint";

export interface PreparedHyperframeLintInput {
  entryFile: string;
  html: string;
  source: "projectDir" | "files" | "html";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((item) => typeof item === "string");
}

function pickEntryFile(files: Record<string, string>, preferredEntryFile?: string): string | null {
  const candidates: string[] = [];
  if (preferredEntryFile) {
    candidates.push(preferredEntryFile);
  }
  candidates.push("index.html", "src/index.html");

  for (const candidate of candidates) {
    const value = files[candidate];
    if (typeof value === "string" && value.length > 0) {
      return candidate;
    }
  }

  for (const [fileName, content] of Object.entries(files)) {
    if (fileName.toLowerCase().endsWith(".html") && content.length > 0) {
      return fileName;
    }
  }

  return null;
}

function readProjectEntryFile(
  projectDir: string,
  preferredEntryFile?: string,
): PreparedHyperframeLintInput | { error: string } {
  const absProjectDir = resolve(projectDir);
  if (!existsSync(absProjectDir) || !statSync(absProjectDir).isDirectory()) {
    return { error: `Project directory not found: ${absProjectDir}` };
  }

  const entryCandidates = [preferredEntryFile, "index.html", "src/index.html"].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );

  for (const entryFile of entryCandidates) {
    const absoluteEntryPath = resolve(absProjectDir, entryFile);
    if (!absoluteEntryPath.startsWith(absProjectDir)) {
      return { error: `Entry file must stay inside project directory: ${entryFile}` };
    }
    if (existsSync(absoluteEntryPath) && statSync(absoluteEntryPath).isFile()) {
      return {
        entryFile,
        html: readFileSync(absoluteEntryPath, "utf-8"),
        source: "projectDir",
      };
    }
  }

  return {
    error: `No HTML entry file found in project directory: ${join(absProjectDir, preferredEntryFile || "index.html")}`,
  };
}

export function prepareHyperframeLintBody(
  body: Record<string, unknown>,
): { prepared: PreparedHyperframeLintInput } | { error: string } {
  const requestedEntryFile =
    typeof body.entryFile === "string" && body.entryFile.trim().length > 0
      ? body.entryFile.trim()
      : undefined;

  if (typeof body.projectDir === "string" && body.projectDir.trim().length > 0) {
    const prepared = readProjectEntryFile(body.projectDir, requestedEntryFile);
    if ("error" in prepared) {
      return prepared;
    }
    return { prepared };
  }

  if (isStringRecord(body.files)) {
    const entryFile = pickEntryFile(body.files, requestedEntryFile);
    if (!entryFile) {
      return { error: "No HTML entry file found in files payload" };
    }
    return {
      prepared: {
        entryFile,
        html: body.files[entryFile] ?? "",
        source: "files",
      },
    };
  }

  if (typeof body.html === "string") {
    return {
      prepared: {
        entryFile: requestedEntryFile || "index.html",
        html: body.html,
        source: "html",
      },
    };
  }

  return { error: "Missing lint source: provide projectDir, files, or html" };
}

export function runHyperframeLint(prepared: PreparedHyperframeLintInput): HyperframeLintResult {
  return lintHyperframeHtml(prepared.html, { filePath: prepared.entryFile });
}
