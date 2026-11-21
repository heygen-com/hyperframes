// One file's first read never answers; a step rewrites or deletes it, then the process dies (mode "open": mid-step).
import { unlinkSync, writeFileSync } from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

const [projectDir, historyRoot, stuck, mode = "close"] = process.argv.slice(2);
const realOpen = fsp.open;
fsp.open = (async (...args: Parameters<typeof realOpen>) => {
  if (String(args[0]) === stuck) await new Promise(() => {});
  return realOpen(...args);
}) as typeof realOpen;
syncBuiltinESMExports();

const { openProjectHistory } = await import("../projectHistory.js");
const history = await openProjectHistory({
  projectDir: projectDir!,
  historyRoot: historyRoot!,
  firstCopyFileMs: 100,
  now: () => Date.now() + 60_000,
});
const step = await history.beginWindow({ kind: "agent", name: "Framey" }, "Step");
if (mode === "delete") unlinkSync(stuck!);
else writeFileSync(stuck!, "// agent\n");
history.noteChange(stuck!);
if (mode !== "open") await step.close();
process.kill(process.pid, "SIGKILL");
