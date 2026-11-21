// One file's first read never answers; a step rewrites or deletes it, then the process dies (mode "open": mid-step).
import { unlinkSync, writeFileSync } from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";

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
const agent = { kind: "agent", name: "Framey" } as const;
const index = join(projectDir!, "index.html");
if (mode === "earlier") {
  writeFileSync(index, "<html>first</html>");
  await history.claim({ kind: "person", name: "You" }, "First", [index]);
}
const step = await history.beginWindow(agent, "Step");
await new Promise((sent) => process.send!({ id: step.id }, sent));
if (mode === "delete") unlinkSync(stuck!);
else writeFileSync(stuck!, "// agent\n");
writeFileSync(index, "<html>agent</html>");
history.noteChange(stuck!);
history.noteChange(index);
if (mode !== "open") await step.close();
process.kill(process.pid, "SIGKILL");
