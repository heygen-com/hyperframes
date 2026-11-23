const PROGRESS_PREFIX = "HYPERFRAMES_BROWSER_INSTALL_PROGRESS:";
const LOG_PREFIX = "HYPERFRAMES_BROWSER_INSTALL_LOG:";

export type InstallEvent =
  | { kind: "progress"; downloaded: number; total: number }
  | { kind: "log"; text: string };

export function installProgressLine(downloaded: number, total: number): string {
  return `${PROGRESS_PREFIX}${JSON.stringify([downloaded, total])}\n`;
}

export function installLogLine(text: string): string {
  return `${LOG_PREFIX}${JSON.stringify(text)}\n`;
}

export function parseInstallLine(line: string): InstallEvent | null {
  try {
    if (line.startsWith(PROGRESS_PREFIX)) {
      const [downloaded, total] = JSON.parse(line.slice(PROGRESS_PREFIX.length)) as [
        number,
        number,
      ];
      return { kind: "progress", downloaded, total };
    }
    if (line.startsWith(LOG_PREFIX)) {
      return { kind: "log", text: JSON.parse(line.slice(LOG_PREFIX.length)) as string };
    }
  } catch {
    // a torn line is dropped: the next progress line carries the same information
  }
  return null;
}
