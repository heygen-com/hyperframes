import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const rows = readdirSync(dir).flatMap((f) =>
  readFileSync(join(dir, f), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l)),
);
const starts = new Map(rows.filter((r) => r.kind === "start").map((r) => [r.pid, r]));
const workers = new Set(
  [...starts.values()].filter((r) => /vitest/.test(r.argv)).map((r) => r.pid),
);
const kills = rows.filter((r) => r.kind === "kill" && r.signal !== "0");
const taskkills = rows.filter((r) => r.kind === "taskkill");
console.log(
  `processes ${starts.size}, vitest processes ${workers.size}, kills ${kills.length}, taskkills ${taskkills.length}`,
);
for (const k of kills) {
  const victim = starts.get(k.target);
  const tag = workers.has(k.target)
    ? "VITEST-TARGET"
    : victim
      ? "logged-target"
      : "UNLOGGED-TARGET";
  if (tag !== "logged-target")
    console.log(
      `${tag} from ${k.pid} (${starts.get(k.pid)?.argv ?? "?"}) -> ${k.target} ${k.signal} :: ${victim?.argv ?? ""} :: ${k.stack}`,
    );
}
for (const t of taskkills) {
  const target = Number(/\/PID\s+(\d+)/i.exec(t.line)?.[1]);
  const tag = workers.has(target)
    ? "VITEST-TARGET"
    : starts.has(target)
      ? "logged-target"
      : "UNLOGGED-TARGET";
  if (tag !== "logged-target")
    console.log(`taskkill ${tag} from ${t.pid} -> ${t.line} :: ${t.stack}`);
}
for (const w of workers) {
  const exit = rows.find((r) => r.kind === "exit" && r.pid === w);
  if (!exit || exit.code !== 0)
    console.log(
      `vitest process ${w} exit ${exit ? exit.code : "NOT LOGGED (killed?)"} :: ${starts.get(w).argv}`,
    );
}
