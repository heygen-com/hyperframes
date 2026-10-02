export interface BrowserInstallFacts {
  /** Four-part build from a managed-cache path (`152.0.7928.2`); absent for a system Chrome. */
  build?: string;
  pathAscii: boolean;
  pathLength: "under_120" | "120_to_199" | "200_to_259" | "260_plus";
  drive: "posix" | "windows_c" | "windows_other" | "unc";
}

// Puppeteer-style cache layout: `<cache>/chrome[-headless-shell]/<platform>-<build>/`.
const BUILD_IN_PATH = /[\\/]chrome(?:-headless-shell)?[\\/][a-z0-9_]+-(\d+\.\d+\.\d+\.\d+)[\\/]/i;

function driveOf(path: string): BrowserInstallFacts["drive"] {
  if (path.startsWith("\\\\") || path.startsWith("//")) return "unc";
  const letter = /^([A-Za-z]):[\\/]/.exec(path)?.[1];
  if (!letter) return "posix";
  return letter.toUpperCase() === "C" ? "windows_c" : "windows_other";
}

function lengthBucket(length: number): BrowserInstallFacts["pathLength"] {
  if (length < 120) return "under_120";
  if (length < 200) return "120_to_199";
  return length < 260 ? "200_to_259" : "260_plus";
}

/** Path-shape facts only; the path itself never leaves the machine. */
export function describeBrowserInstall(executablePath: string): BrowserInstallFacts {
  const build = BUILD_IN_PATH.exec(executablePath)?.[1];
  return {
    ...(build ? { build } : {}),
    pathAscii: /^\p{ASCII}*$/u.test(executablePath),
    pathLength: lengthBucket(executablePath.length),
    drive: driveOf(executablePath),
  };
}
