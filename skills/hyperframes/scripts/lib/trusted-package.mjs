// A skill installed inside a project sits below the project's node_modules, so a bare import from a skill script
// would run whatever package the project ships under that name. These load a package only from a folder the person
// controls: an absolute path they set, their home folder, or npm's global folder.
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

/** npm's default global package folder for the running Node. */
export function npmGlobalFolder(env = process.env, platform = process.platform) {
  if (platform === "win32")
    return join(env.APPDATA || dirname(process.execPath), "npm", "node_modules");
  return join(dirname(dirname(process.execPath)), "lib", "node_modules");
}

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
  { override, overrideName, home = homedir(), globalFolder = npmGlobalFolder() } = {},
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
  return resolveFrom(home, name) ?? resolveFrom(globalFolder, name);
}

/** The module at a resolved entry, with its default export unwrapped. */
export async function importEntry(entry) {
  const loaded = await import(pathToFileURL(entry).href);
  return loaded.default ?? loaded;
}
