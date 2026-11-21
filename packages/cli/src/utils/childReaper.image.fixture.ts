// fallow-ignore-file unused-file
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { killWithThisProcess } from "./childReaper.js";

const [readyPath] = process.argv.slice(2);
if (!readyPath) throw new Error("Missing fixture arguments");

const standIn = () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  child.unref();
  return child.pid!;
};
const own = standIn();
const reused = standIn();
// The reaper kills in this order, so the reused pid's turn is over once the own child is gone.
killWithThisProcess(reused, false, "ffmpeg.exe");
killWithThisProcess(own, false, "node.exe");
writeFileSync(readyPath, JSON.stringify({ own, reused }));
