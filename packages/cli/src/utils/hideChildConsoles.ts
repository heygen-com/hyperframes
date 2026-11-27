import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { promisify } from "node:util";

type Spawner = (command: string, ...rest: unknown[]) => unknown;
type ChildProcessModule = Record<string, unknown>;

const ENTRY_POINTS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"];

export const TASKKILL_TIMEOUT_MS = 5_000;
const TASKKILL = /^taskkill(\s|$)/i;

/** `windowsHide: true` unless the caller chose; taskkill runs shell-less, silenced and capped, as WMI can hang. */
function hidden(command: string, rest: unknown[]): unknown[] {
  const defaults = TASKKILL.test(command)
    ? { windowsHide: true, stdio: "ignore", timeout: TASKKILL_TIMEOUT_MS }
    : { windowsHide: true };
  const args = [...rest];
  const at = args.findIndex((arg) => arg && typeof arg === "object" && !Array.isArray(arg));
  if (at >= 0) {
    args[at] = { ...defaults, ...(args[at] as object) };
  } else {
    const callback = args.findIndex((arg) => typeof arg === "function");
    args.splice(callback < 0 ? args.length : callback, 0, defaults);
  }
  return [command, ...args];
}

/** Windows opens a console window for every child that does not say `windowsHide`; `false` opts out. */
export function hideChildConsoles(
  target: ChildProcessModule = childProcess as unknown as ChildProcessModule,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== "win32") return;
  for (const name of ENTRY_POINTS) {
    const original = target[name] as Spawner & { [promisify.custom]?: Spawner };
    const wrapped: Spawner & { [promisify.custom]?: Spawner } = (command, ...rest) =>
      name === "execSync" && TASKKILL.test(command)
        ? (target.execFileSync as Spawner)(
            "taskkill",
            command.trim().split(/\s+/).slice(1),
            ...rest,
          )
        : original(...(hidden(command, rest) as [string, ...unknown[]]));
    const custom = original[promisify.custom];
    if (custom)
      wrapped[promisify.custom] = (command, ...rest) =>
        custom(...(hidden(command, rest) as [string]));
    target[name] = wrapped;
  }
  if (target === (childProcess as unknown as ChildProcessModule)) syncBuiltinESMExports();
}

hideChildConsoles();
