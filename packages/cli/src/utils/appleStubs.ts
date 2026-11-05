import { accessSync, constants, existsSync, realpathSync } from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";

// Without the developer tools these /usr/bin commands are stubs that open macOS's install dialog and fail.
const STUBS = new Set(["git", "xcrun", "make", "cc", "clang", "gcc", "python3", "swift", "swiftc"]);
const XCODE = "/Applications/Xcode.app/Contents/Developer";
const COMMAND_LINE_TOOLS = "/Library/Developer/CommandLineTools";

type Host = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists: (path: string) => boolean;
  executable: (path: string) => boolean;
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
  executable: (path) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  realpath: (path) => {
    try {
      return realpathSync(path);
    } catch {
      return null;
    }
  },
};

/** Where xcode-select looks: DEVELOPER_DIR, the folder chosen with `xcode-select -s`, else Xcode.app or the tools. */
function developerDirs(h: Host): string[] {
  const chosen = h.env.DEVELOPER_DIR || h.realpath("/var/db/xcode_select_link");
  return chosen ? [chosen] : [XCODE, COMMAND_LINE_TOOLS];
}

/** Whether running `command` (a resolved path or a stub's name) does the work rather than open that dialog. */
export function runsWithoutInstallPrompt(command: string, h: Host = host): boolean {
  if (h.platform !== "darwin") return true;
  const inUsrBin = !command.includes("/") || dirname(command) === "/usr/bin";
  if (!inUsrBin || !STUBS.has(basename(command))) return true;
  return developerDirs(h).some((dir) => h.exists(join(dir, "usr", "bin")));
}

/** The first executable `name` on PATH, found without running anything. */
export function onPath(name: string, h: Host = host): string | undefined {
  for (const dir of (h.env.PATH ?? "").split(delimiter)) {
    const file = dir && join(dir, name);
    if (file && h.executable(file)) return file;
  }
  return undefined;
}
