import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function expandWorkspaceGlob(rootDir, pattern) {
  if (!pattern.endsWith("/*")) {
    throw new Error(`Unsupported workspace pattern: ${pattern}`);
  }

  const baseDir = resolve(rootDir, pattern.slice(0, -2));
  return readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(baseDir, entry.name));
}

function getWorkspaceDepNames(pkg, workspaceNames) {
  const depNames = new Set();

  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const deps = pkg[section] ?? {};
    for (const name of Object.keys(deps)) {
      if (workspaceNames.has(name)) depNames.add(name);
    }
  }

  return [...depNames].sort();
}

export function readBuildWorkspaces(rootDir) {
  const rootPkg = readJson(join(rootDir, "package.json"));
  const workspaceDirs = (rootPkg.workspaces ?? []).flatMap((pattern) =>
    expandWorkspaceGlob(rootDir, pattern),
  );

  const packages = workspaceDirs.map((dir) => {
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) return null;

    const pkg = readJson(pkgPath);
    return {
      dir,
      name: pkg.name,
      hasBuild: typeof pkg.scripts?.build === "string",
      pkg,
    };
  });

  const buildPackages = packages.filter((pkg) => pkg?.hasBuild);
  const workspaceNames = new Set(buildPackages.map((pkg) => pkg.name));

  return buildPackages
    .map((pkg) => ({
      name: pkg.name,
      dir: pkg.dir,
      deps: getWorkspaceDepNames(pkg.pkg, workspaceNames),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function createBuildBatches(workspaces) {
  const names = new Set(workspaces.map((workspace) => workspace.name));
  const nodes = new Map(
    workspaces.map((workspace) => [
      workspace.name,
      {
        ...workspace,
        deps: [...workspace.deps].filter((dep) => names.has(dep)).sort(),
      },
    ]),
  );
  const inDegree = new Map();
  const dependents = new Map();

  for (const workspace of nodes.values()) {
    inDegree.set(workspace.name, workspace.deps.length);
    for (const dep of workspace.deps) {
      if (!nodes.has(dep)) continue;
      const names = dependents.get(dep) ?? [];
      names.push(workspace.name);
      dependents.set(dep, names);
    }
  }

  const batches = [];
  let ready = [...nodes.values()]
    .filter((workspace) => inDegree.get(workspace.name) === 0)
    .map((workspace) => workspace.name)
    .sort();
  let seen = 0;

  while (ready.length > 0) {
    const batch = ready;
    batches.push(batch);
    ready = [];
    seen += batch.length;

    for (const name of batch) {
      for (const dependent of (dependents.get(name) ?? []).sort()) {
        const nextDegree = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, nextDegree);
        if (nextDegree === 0) ready.push(dependent);
      }
    }

    ready.sort();
  }

  if (seen !== nodes.size) {
    const remaining = [...nodes.keys()].filter((name) => (inDegree.get(name) ?? 0) > 0).sort();
    throw new Error(`Workspace build graph contains a cycle: ${remaining.join(", ")}`);
  }

  return batches;
}
