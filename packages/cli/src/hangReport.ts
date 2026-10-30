import "./utils/hideChildConsoles.js";
import { writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const QUIET_MS = 60_000;

interface Output {
  write: (...args: never[]) => unknown;
}

/** Writes the report without environment values; before Node 22.13 that is impossible, so nothing is written. */
export function writeReportFile(
  path: string,
  report: Pick<typeof process.report, "getReport"> = process.report,
): boolean {
  if (!("excludeEnv" in report)) return false;
  report.excludeEnv = true;
  // writeReport announces the file on stderr; getReport keeps the file the only trace.
  writeFileSync(path, JSON.stringify(report.getReport()), { mode: 0o600 });
  return true;
}

/** With HYPERFRAMES_HANG_REPORT=<absolute dir>, one diagnostic report after 60 s of silence; behaviour is unchanged. */
export function watchForHang(
  outputs: readonly Output[] = [process.stdout, process.stderr],
  env = process.env,
  writeReport: (path: string) => unknown = writeReportFile,
): void {
  const dir = env.HYPERFRAMES_HANG_REPORT;
  if (!dir || !isAbsolute(dir)) return;
  let timer: NodeJS.Timeout | undefined;
  let written = false;
  const arm = () => {
    if (written) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      written = true;
      try {
        writeReport(join(dir, `hang-${process.pid}.json`));
      } catch {}
    }, QUIET_MS).unref();
  };
  for (const output of outputs) {
    const write = output.write.bind(output);
    output.write = (...args: never[]) => {
      arm();
      return write(...args);
    };
  }
  arm();
}
