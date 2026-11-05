import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// Until the Command Line Tools are installed, macOS ships these in /usr/bin as stubs: running one shows a dialog
// asking to install them and fails. Checked without running them.
const STUBS = new Set(["git", "xcrun", "make", "cc", "clang", "gcc", "python3", "swift", "swiftc"]);

type Host = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists: (path: string) => boolean;
  realpath: (path: string) => string | null;
};

const host: Host = {
  get platform() {
    return process.platform;
  },
  get env() {
    return process.env;
  },
  exists: existsSync,
  realpath: (path) => {
    try {
      return realpathSync(path);
    } catch {
      return null;
    }
  },
};

/** The developer folder xcode-select would name: DEVELOPER_DIR, the folder it last chose, or the tools' default. */
function developerDir(h: Host): string {
  return (
    h.env.DEVELOPER_DIR ||
    h.realpath("/var/db/xcode_select_link") ||
    "/Library/Developer/CommandLineTools"
  );
}

/**
 * Whether running `command` (a resolved path, or a stub's name) does the work rather than open macOS's
 * "install the developer tools" dialog. Anything outside /usr/bin, or off macOS, is a real tool.
 */
export function runsWithoutInstallPrompt(command: string, h: Host = host): boolean {
  if (h.platform !== "darwin") return true;
  const inUsrBin = !command.includes("/") || dirname(command) === "/usr/bin";
  if (!inUsrBin || !STUBS.has(basename(command))) return true;
  return h.exists(join(developerDir(h), "usr", "bin"));
}

/** The first executable `name` on PATH, found without running anything. */
export function onPath(name: string, h: Host = host): string | undefined {
  for (const dir of (h.env.PATH ?? "").split(":")) {
    if (dir && h.exists(join(dir, name))) return join(dir, name);
  }
  return undefined;
}
