import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPOSITORY_ROOT = join(import.meta.dirname, "..");

export type PublishMode = "workspace" | "manifest-name-override";

export type PublishablePackage = {
  workspacePath: string;
  workspaceName: string;
  npmName: string;
  publishMode: PublishMode;
};

export type DiscoveredWorkspace = {
  workspacePath: string;
  workspaceName: string;
  private: boolean;
};

function packageEntry(
  workspacePath: string,
  workspaceName: string,
  npmName: string,
  publishMode: PublishMode = "workspace",
): PublishablePackage {
  return { workspacePath, workspaceName, npmName, publishMode };
}

/** Ordered release roster shared by versioning and npm publication. */
export const PUBLISHABLE_PACKAGES: readonly PublishablePackage[] = [
  packageEntry("packages/parsers", "@hyperframes/parsers", "@hyperframes/parsers"),
  packageEntry("packages/lint", "@hyperframes/lint", "@hyperframes/lint"),
  packageEntry(
    "packages/studio-server",
    "@hyperframes/studio-server",
    "@hyperframes/studio-server",
  ),
  packageEntry("packages/core", "@hyperframes/core", "@hyperframes/core"),
  packageEntry("packages/sdk", "@hyperframes/sdk", "@hyperframes/sdk"),
  packageEntry("packages/engine", "@hyperframes/engine", "@hyperframes/engine"),
  packageEntry("packages/player", "@hyperframes/player", "@hyperframes/player"),
  packageEntry("packages/producer", "@hyperframes/producer", "@hyperframes/producer"),
  packageEntry(
    "packages/shader-transitions",
    "@hyperframes/shader-transitions",
    "@hyperframes/shader-transitions",
  ),
  packageEntry("packages/studio", "@hyperframes/studio", "@hyperframes/studio"),
  packageEntry("packages/aws-lambda", "@hyperframes/aws-lambda", "@hyperframes/aws-lambda"),
  packageEntry(
    "packages/gcp-cloud-run",
    "@hyperframes/gcp-cloud-run",
    "@hyperframes/gcp-cloud-run",
  ),
  packageEntry("packages/cli", "@hyperframes/cli", "hyperframes", "manifest-name-override"),
];

type WorkspaceManifest = { name?: unknown; private?: unknown; workspaces?: unknown };

function readManifest(path: string): WorkspaceManifest {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Package manifest ${path} must contain a JSON object.`);
  }
  return value;
}

// Fail-closed workspace-pattern validation is intentionally kept at discovery's single boundary.
// fallow-ignore-next-line complexity
function configuredWorkspaceDirectories(root: string): string[] {
  const workspaces = readManifest(join(root, "package.json")).workspaces;
  if (!Array.isArray(workspaces) || !workspaces.every((value) => typeof value === "string")) {
    throw new Error("Root package.json must define an array of workspaces.");
  }
  const directories: string[] = [];
  for (const pattern of workspaces) {
    if (!pattern.endsWith("/*") || pattern.slice(0, -2).includes("*")) {
      throw new Error(`Unsupported workspace pattern ${JSON.stringify(pattern)}.`);
    }
    const parent = pattern.slice(0, -2);
    for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(join(parent, entry.name));
    }
  }
  return directories.sort();
}

export function discoverWorkspacePackages(root: string): DiscoveredWorkspace[] {
  return configuredWorkspaceDirectories(root).map((workspacePath) => {
    const manifestPath = join(root, workspacePath, "package.json");
    if (!existsSync(manifestPath))
      throw new Error(`Workspace manifest does not exist: ${manifestPath}`);
    const manifest = readManifest(manifestPath);
    if (typeof manifest.name !== "string" || manifest.name.length === 0) {
      throw new Error(`Workspace manifest ${manifestPath} has no package name.`);
    }
    return { workspacePath, workspaceName: manifest.name, private: manifest.private === true };
  });
}

function rejectDuplicates(roster: readonly PublishablePackage[], key: keyof PublishablePackage) {
  const seen = new Set<string>();
  for (const entry of roster) {
    const value = entry[key];
    if (seen.has(value)) throw new Error(`Duplicate ${key} in publish roster: ${value}`);
    seen.add(value);
  }
}

// One reconciliation pass owns every roster invariant so consumers cannot validate subsets.
// fallow-ignore-next-line complexity
export function validatePublishablePackages(
  root: string,
  roster: readonly PublishablePackage[] = PUBLISHABLE_PACKAGES,
): readonly PublishablePackage[] {
  rejectDuplicates(roster, "workspacePath");
  rejectDuplicates(roster, "workspaceName");
  rejectDuplicates(roster, "npmName");
  const discovered = discoverWorkspacePackages(root);
  const byPath = new Map(discovered.map((workspace) => [workspace.workspacePath, workspace]));

  for (const entry of roster) {
    const manifestPath = join(root, entry.workspacePath, "package.json");
    if (!existsSync(manifestPath))
      throw new Error(`Package manifest does not exist: ${manifestPath}`);
    const workspace = byPath.get(entry.workspacePath);
    if (!workspace)
      throw new Error(`Roster path is not a configured workspace: ${entry.workspacePath}`);
    if (workspace.workspaceName !== entry.workspaceName) {
      throw new Error(
        `Workspace name mismatch at ${entry.workspacePath}: expected ${entry.workspaceName}, found ${workspace.workspaceName}.`,
      );
    }
    if (workspace.private)
      throw new Error(`Private workspace cannot be a publish roster entry: ${entry.workspaceName}`);
    if (entry.publishMode === "workspace" && entry.npmName !== entry.workspaceName) {
      throw new Error(
        `Package name mapping for ${entry.workspaceName} requires manifest-name-override mode.`,
      );
    }
    if (entry.publishMode === "manifest-name-override" && entry.npmName === entry.workspaceName) {
      throw new Error(
        `manifest-name-override requires a distinct npm name for ${entry.workspaceName}.`,
      );
    }
    if (
      entry.publishMode === "manifest-name-override" &&
      (entry.workspacePath !== "packages/cli" ||
        entry.workspaceName !== "@hyperframes/cli" ||
        entry.npmName !== "hyperframes")
    ) {
      throw new Error(
        "Only @hyperframes/cli may use manifest-name-override to publish as hyperframes.",
      );
    }
    if (entry.publishMode !== "workspace" && entry.publishMode !== "manifest-name-override") {
      throw new Error(`Invalid publish mode for ${entry.workspaceName}.`);
    }
  }

  const rosterNames = new Set(roster.map((entry) => entry.workspaceName));
  for (const workspace of discovered) {
    if (!workspace.private && !rosterNames.has(workspace.workspaceName)) {
      throw new Error(
        `Public workspace ${workspace.workspaceName} is missing from the publish roster.`,
      );
    }
    if (workspace.private && rosterNames.has(workspace.workspaceName)) {
      throw new Error(
        `Private workspace ${workspace.workspaceName} cannot be in the publish roster.`,
      );
    }
  }
  return roster;
}

/** CI-facing contract that directly reconciles the checked-out repository tree. */
export function validateRepositoryPublishablePackages(): readonly PublishablePackage[] {
  return validatePublishablePackages(REPOSITORY_ROOT);
}
