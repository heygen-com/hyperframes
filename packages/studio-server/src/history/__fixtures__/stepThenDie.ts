// A first open whose read of one file never answers; an agent step goes ahead and rewrites it, then the process dies.
import { writeFileSync } from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

const [projectDir, historyRoot, stuck] = process.argv.slice(2);
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
writeFileSync(stuck!, "// agent\n");
history.noteChange(stuck!);
await step.close();
process.kill(process.pid, "SIGKILL");
