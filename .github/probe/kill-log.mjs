import cp from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";

const dir = process.env.HF_KILL_LOG_DIR;
if (dir) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${process.pid}.log`);
  const note = (kind, fields) =>
    appendFileSync(
      file,
      `${JSON.stringify({ kind, pid: process.pid, at: Date.now(), ...fields })}\n`,
    );
  const stack = () =>
    (new Error().stack ?? "")
      .split("\n")
      .slice(3, 9)
      .map((l) => l.trim())
      .join(" | ");
  note("start", { ppid: process.ppid, argv: process.argv.slice(0, 4).join(" ").slice(0, 300) });
  process.on("exit", (code) => note("exit", { code }));
  const kill = process.kill.bind(process);
  process.kill = (target, signal) => {
    if (Number(target) !== process.pid || signal !== 0)
      note("kill", { target: Number(target), signal: String(signal ?? "SIGTERM"), stack: stack() });
    return kill(target, signal);
  };
  for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"]) {
    const real = cp[name];
    cp[name] = function (command, ...rest) {
      const args = Array.isArray(rest[0]) ? rest[0] : [];
      const line = `${command} ${args.join(" ")}`;
      if (/taskkill/i.test(line)) note("taskkill", { line: line.slice(0, 200), stack: stack() });
      return real.call(this, command, ...rest);
    };
  }
  syncBuiltinESMExports();
}
