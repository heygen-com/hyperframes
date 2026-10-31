// Repro-only preload (NODE_OPTIONS=--require): log every delete/rename of a frame or capture dir with its caller.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const WATCHED =
  /frame_\d|captured-frames|capture-attempt-\d|worker-\d|work-[0-9a-f]{8}|hf-render|extract|frame-cache|hyperframes[\\/]cache/;
function trace(op, args) {
  const paths = args.filter((a) => typeof a === "string" || a instanceof URL).map(String);
  if (process.env.HF_TRACE_ALL !== "1" && !paths.some((p) => WATCHED.test(p))) return;
  const stack = (new Error().stack || "")
    .split("\n")
    .slice(3, 9)
    .map((l) => l.trim())
    .join(" < ");
  process.stderr.write(
    `[frame-fs] ${new Date().toISOString()} pid ${process.pid} ${op} ${paths.join(" -> ")} | ${stack}\n`,
  );
}
for (const op of [
  "rename",
  "renameSync",
  "unlink",
  "unlinkSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
]) {
  const original = fs[op];
  fs[op] = function (...args) {
    trace(op, args);
    return original.apply(this, args);
  };
}
for (const op of ["rename", "unlink", "rm", "rmdir"]) {
  const original = fsp[op];
  fsp[op] = function (...args) {
    trace(`promises.${op}`, args);
    return original.apply(this, args);
  };
}
process.stderr.write(`[frame-fs] tracing on, pid ${process.pid}\n`);
