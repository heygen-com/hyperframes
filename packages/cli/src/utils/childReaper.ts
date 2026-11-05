import { spawn, type ChildProcess } from "node:child_process";

// Ends with this process's end of its stdin, however this process died, and kills what is still held.
const REAPER = `const held = new Map();
let rest = "";
const kill = (pid, group) => {
  try {
    if (process.platform === "win32")
      require("node:child_process").spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { windowsHide: true, timeout: 10000 });
    else process.kill(group ? -Number(pid) : Number(pid), "SIGKILL");
  } catch {}
};
process.stdin.on("data", (data) => {
  const lines = (rest + data).split("\\n");
  rest = lines.pop();
  for (const [op, pid, group] of lines.map((line) => line.split(" ")))
    op === "+" ? held.set(pid, group === "g") : held.delete(pid);
});
const done = () => {
  for (const [pid, group] of held) kill(pid, group);
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

/** Kills `pid`, its whole process group when `group`, if this process ends before the returned release runs. */
export function killWithThisProcess(pid: number, group: boolean): () => void {
  const stdin = lifeline();
  stdin?.write(`+ ${pid} ${group ? "g" : "p"}\n`);
  return () => void stdin?.write(`- ${pid}\n`);
}
