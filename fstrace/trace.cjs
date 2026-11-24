const fs = require("fs");
const cp = require("child_process");
const NAMES = /host|unc\.mov|encoded\.mov|outside\.mov|private\.mov|%5C/i;
const seen = new Map();
function note(kind, arg) {
  const s = String(arg);
  if (!NAMES.test(s)) return;
  const stack = new Error().stack.split("\n").slice(2, 9).map((l) => l.trim()).filter((l) => !l.includes("trace.cjs")).join(" | ");
  const key = `${kind} ${s} ${stack}`;
  if (seen.has(key)) return;
  seen.set(key, 1);
  fs.appendFileSync(process.env.HF_TRACE_OUT, `${kind} ${s}\n   ${stack}\n`);
}
for (const name of ["existsSync","statSync","lstatSync","readFileSync","openSync","createReadStream","realpathSync","accessSync","readdirSync","stat","lstat","open","readFile","access","realpath"]) {
  const orig = fs[name];
  if (typeof orig !== "function") continue;
  fs[name] = function (p, ...rest) { note(`fs.${name}`, p); return orig.call(this, p, ...rest); };
  if (orig.native) fs[name].native = function (p, ...rest) { note(`fs.${name}.native`, p); return orig.native.call(this, p, ...rest); };
}
for (const name of ["stat","lstat","open","readFile","access","realpath"]) {
  const orig = fs.promises[name];
  fs.promises[name] = function (p, ...rest) { note(`fsp.${name}`, p); return orig.call(this, p, ...rest); };
}
for (const name of ["spawn","execFile","execFileSync","spawnSync"]) {
  const orig = cp[name];
  cp[name] = function (file, args, ...rest) { if (Array.isArray(args)) for (const a of args) note(`cp.${name}:${file}`, a); return orig.call(this, file, args, ...rest); };
}
require("module").syncBuiltinESMExports();
