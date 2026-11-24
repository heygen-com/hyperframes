// A skill installed inside a project sits below the project's node_modules, so a bare import from a skill script
// would run whatever package the project ships under that name. These load a package only from an absolute path the
// person sets, a lookup starting in their home folder (which also reads the system folders above it), or the folder
// `npm install --global` uses.
import "./windows-exe-search.mjs";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

// npm runs in the home folder, so no project's .npmrc can name the folder.
function askNpm(home) {
  const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const windows = process.platform === "win32";
  if (windows && !existsSync(npmCli)) return null;
  const [command, args] = windows
    ? [process.execPath, [npmCli, "root", "--global"]]
    : ["npm", ["root", "--global"]];
  const run = spawnSync(command, args, {
    cwd: home,
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const folder = run.status === 0 ? run.stdout.trim() : "";
  return isAbsolute(folder) ? folder : null;
}

/** The folder `npm install --global` uses, as npm reports it; npm's default for the running Node when npm cannot say. */
export function npmGlobalFolder({ home = homedir(), env = process.env } = {}) {
  const asked = askNpm(home);
  if (asked) return asked;
  if (process.platform === "win32")
    return join(env.APPDATA || dirname(process.execPath), "npm", "node_modules");
  return join(dirname(dirname(process.execPath)), "lib", "node_modules");
}

/** The folders a lookup without an override reads, for the message when none holds the package. */
export const searchedFolders = ({ home = homedir(), globalFolder } = {}) => [
  join(home, "node_modules"),
  globalFolder ?? npmGlobalFolder({ home }),
];

function resolveFrom(folder, name) {
  try {
    return createRequire(join(folder, "lookup.cjs")).resolve(name);
  } catch {
    return null;
  }
}

/**
 * The entry file of package `name`: from `override`, the absolute path of a package folder the person set, or else
 * looked up from their home folder and then npm's global folder. Null when neither has it; throws for a bad override.
 */
export function trustedPackageEntry(
  name,
  { override, overrideName, home = homedir(), globalFolder } = {},
) {
  if (override) {
    if (!isAbsolute(override)) {
      throw new Error(`${overrideName} must be an absolute path to a ${name} folder you installed`);
    }
    const entry = resolveFrom(dirname(override), override);
    if (!entry)
      throw new Error(`${overrideName} names ${override}, which holds no ${name} package`);
    return entry;
  }
  return resolveFrom(home, name) ?? resolveFrom(globalFolder ?? npmGlobalFolder({ home }), name);
}

/** The module at a resolved entry, with its default export unwrapped. */
export async function importEntry(entry) {
  const loaded = await import(pathToFileURL(entry).href);
  return loaded.default ?? loaded;
}
