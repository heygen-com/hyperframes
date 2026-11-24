import { spawn, type ChildProcess } from "node:child_process";
import { windowsOwnTreeKillArgs } from "./processTree.js";

// Ends with this process's end of its stdin, however this process died, and kills what is still held.
const REAPER = `const held = new Map();
let rest = "";
const killArgs = ${windowsOwnTreeKillArgs};
const kill = (pid, { group, image }) => {
  try {
    if (process.platform === "win32")
      require("node:child_process").spawnSync("taskkill", killArgs(pid, image), { windowsHide: true, timeout: 10000 });
    else process.kill(group ? -Number(pid) : Number(pid), "SIGKILL");
  } catch {}
};
process.stdin.on("data", (data) => {
  const lines = (rest + data).split("\\n");
  rest = lines.pop();
  for (const [op, pid, group, ...image] of lines.map((line) => line.split(" ")))
    op === "+" ? held.set(pid, { group: group === "g", image: image.join(" ") }) : held.delete(pid);
});
const done = () => {
  for (const [pid, child] of held) kill(pid, child);
  process.exit(0);
};
process.stdin.on("end", done);
process.stdin.on("error", done);`;

let reaper: ChildProcess | undefined;

function lifeline(): NodeJS.WritableStream | null {
  if (!reaper) {
    reaper = spawn(process.execPath, ["-e", REAPER], {
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
    });
    reaper.on("error", () => {});
    reaper.stdin?.on("error", () => {});
    reaper.unref();
    (reaper.stdin as unknown as { unref?: () => void } | null)?.unref?.();
  }
  return reaper.stdin;
}

/** Kills `pid` (its group when `group`; on Windows only while it runs `image`) if this process ends before release. */
export function killWithThisProcess(pid: number, group: boolean, image: string): () => void {
  const stdin = lifeline();
  stdin?.write(`+ ${pid} ${group ? "g" : "p"} ${image}\n`);
  return () => void stdin?.write(`- ${pid}\n`);
}
