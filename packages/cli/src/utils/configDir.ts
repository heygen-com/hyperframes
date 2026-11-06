import { constants, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const homeConfigDir = () => join(homedir(), ".hyperframes");

export function hyperframesConfigDir(...parts: string[]): string {
  return join(process.env["HYPERFRAMES_CONFIG_DIR"] || homeConfigDir(), ...parts);
}

/** A settings file under HYPERFRAMES_CONFIG_DIR starts as a copy of ~/.hyperframes' one, so an opt-out moves too. */
export function seededConfigFile(name: string): string {
  const file = hyperframesConfigDir(name);
  const home = join(homeConfigDir(), name);
  if (file === home || existsSync(file) || !existsSync(home)) return file;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    copyFileSync(home, file, constants.COPYFILE_EXCL);
  } catch {
    // expected: an unreadable home folder, or another CLI seeded it first; the caller reads what is there
  }
  return file;
}
