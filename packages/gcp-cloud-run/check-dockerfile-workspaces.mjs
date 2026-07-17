import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "../..");
const ENTRY_PACKAGE = "@hyperframes/gcp-cloud-run";
const PRODUCER_PACKAGE = "@hyperframes/producer";
const RUNTIME_DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];

export function readWorkspacePackages(root = ROOT) {
  return readdirSync(join(root, "packages"))
    .sort()
    .filter((directory) => existsSync(join(root, "packages", directory, "package.json")))
    .map((directory) => ({
      directory,
      manifest: JSON.parse(readFileSync(join(root, "packages", directory, "package.json"), "utf8")),
    }));
}

export function findRuntimeWorkspaceDirectories(workspaces, entryPackage = ENTRY_PACKAGE) {
  const workspaceByName = new Map(
    workspaces.map((workspace) => [workspace.manifest.name, workspace]),
  );
  const visited = new Set();
  addRuntimeWorkspace(entryPackage, workspaceByName, visited);
  return new Set([...visited].map((packageName) => workspaceByName.get(packageName).directory));
}

function addRuntimeWorkspace(packageName, workspaceByName, visited) {
  if (visited.has(packageName)) return;
  const workspace = workspaceByName.get(packageName);
  if (!workspace) return;

  visited.add(packageName);
  RUNTIME_DEPENDENCY_FIELDS.flatMap((field) => Object.keys(workspace.manifest[field] ?? {}))
    .filter((dependencyName) => workspaceByName.has(dependencyName))
    .forEach((dependencyName) => addRuntimeWorkspace(dependencyName, workspaceByName, visited));
}

function copiedWorkspaceDirectories(dockerfile, manifestOnly) {
  const pattern = manifestOnly
    ? /^COPY packages\/([^/\s]+)\/package\.json\s+packages\/\1\/package\.json\s*$/gm
    : /^COPY packages\/([^/\s]+)\/\s+packages\/\1\/\s*$/gm;
  return new Set([...dockerfile.matchAll(pattern)].map((match) => match[1]));
}

function fullBuildPositions(dockerfile) {
  const normalized = dockerfile.replace(/\\\r?\n\s*/g, " ");
  const entries = [...normalized.matchAll(/^RUN\s+(.+)$/gm)].flatMap((instruction) =>
    buildEntries(instruction[1], instruction.index),
  );
  return entries.reduce((positions, [directory, position]) => {
    const current = positions.get(directory);
    if (current === undefined || position < current) positions.set(directory, position);
    return positions;
  }, new Map());
}

function buildEntries(instruction, instructionPosition) {
  const cwdEntries = [
    ...instruction.matchAll(/bun run --cwd packages\/([a-z0-9-]+) build(?=\s|&&|$)/g),
  ].map((match) => [match[1], instructionPosition + match.index]);
  const filterEntries = [
    ...instruction.matchAll(
      /bun run --filter\s+['"]?@hyperframes\/(\{[^}]+\}|[a-z0-9-]+)['"]?\s+build(?=\s|&&|$)/g,
    ),
  ].flatMap((match) => {
    const directories = match[1].startsWith("{") ? match[1].slice(1, -1).split(",") : [match[1]];
    return directories.map((directory) => [directory.trim(), instructionPosition + match.index]);
  });
  return [...cwdEntries, ...filterEntries];
}

export function listDockerfileWorkspaceIssues(dockerfile, workspaces) {
  const runtimeDirectories = findRuntimeWorkspaceDirectories(workspaces);
  return [
    ...missingDirectoryIssues(
      "missing workspace manifests",
      workspaces.map((workspace) => workspace.directory),
      copiedWorkspaceDirectories(dockerfile, true),
    ),
    ...missingDirectoryIssues(
      "missing runtime workspace sources",
      runtimeDirectories,
      copiedWorkspaceDirectories(dockerfile, false),
    ),
    ...buildIssues(dockerfile, workspaces, runtimeDirectories),
  ];
}

function missingDirectoryIssues(label, requiredDirectories, presentDirectories) {
  const missing = [...requiredDirectories]
    .filter((directory) => !presentDirectories.has(directory))
    .sort();
  return missing.length > 0 ? [`${label}: ${missing.join(", ")}`] : [];
}

function buildIssues(dockerfile, workspaces, runtimeDirectories) {
  const workspaceByName = new Map(
    workspaces.map((workspace) => [workspace.manifest.name, workspace]),
  );
  const workspaceByDirectory = new Map(
    workspaces.map((workspace) => [workspace.directory, workspace]),
  );
  const buildPositions = fullBuildPositions(dockerfile);
  const producerDirectory = workspaceByName.get(PRODUCER_PACKAGE)?.directory;
  const entryDirectory = workspaceByName.get(ENTRY_PACKAGE)?.directory;
  const producerPosition = buildPositions.get(producerDirectory);
  const entryPosition = buildPositions.get(entryDirectory);
  return [
    ...prerequisiteBuildIssues(
      runtimeDirectories,
      workspaceByDirectory,
      buildPositions,
      producerDirectory,
      entryDirectory,
    ),
    ...producerBuildIssues(producerPosition),
    ...entryBuildIssues(entryPosition, producerPosition),
  ];
}

function prerequisiteBuildIssues(
  runtimeDirectories,
  workspaceByDirectory,
  buildPositions,
  producerDirectory,
  entryDirectory,
) {
  const producerPosition = buildPositions.get(producerDirectory);
  const missing = [...runtimeDirectories]
    .filter((directory) => directory !== producerDirectory)
    .filter((directory) => directory !== entryDirectory)
    .filter(
      (directory) =>
        typeof workspaceByDirectory.get(directory)?.manifest.scripts?.build === "string",
    )
    .filter((directory) => !isBuiltBefore(directory, producerPosition, buildPositions))
    .sort();
  return missing.length > 0
    ? [`runtime workspaces must run their full build before producer: ${missing.join(", ")}`]
    : [];
}

function producerBuildIssues(producerPosition) {
  return producerPosition === undefined ? ["missing full producer build"] : [];
}

function isBuiltBefore(directory, laterPosition, buildPositions) {
  const position = buildPositions.get(directory);
  return position !== undefined && laterPosition !== undefined && position < laterPosition;
}

function entryBuildIssues(entryPosition, producerPosition) {
  if (entryPosition === undefined) return ["missing full gcp-cloud-run build"];
  if (producerPosition !== undefined && producerPosition > entryPosition) {
    return ["producer must be built before gcp-cloud-run"];
  }
  return [];
}

export function checkDockerfileWorkspaces(root = ROOT) {
  const dockerfile = readFileSync(join(root, "packages/gcp-cloud-run/Dockerfile"), "utf8");
  const workspaces = readWorkspacePackages(root);
  const issues = listDockerfileWorkspaceIssues(dockerfile, workspaces);
  if (issues.length > 0) {
    throw new Error(`GCP Cloud Run Dockerfile workspace violations:\n- ${issues.join("\n- ")}`);
  }
  return workspaces.length;
}

function main() {
  const workspaceCount = checkDockerfileWorkspaces();
  console.log(`GCP Cloud Run Dockerfile covers ${workspaceCount} workspace manifests.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
