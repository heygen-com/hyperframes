// Reads of `stuck` (comma-separated) never answer; a step rewrites or deletes them, then the process dies: "open"
// mid-step, "reopen"/"reopen-list" recovering the JSON window, at its first sweep/went-ahead.json write.
import fs, { unlinkSync, writeFileSync } from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";

const [projectDir, historyRoot, stuck, mode = "close", closedWindow] = process.argv.slice(2);
const stuckFiles = stuck!.split(",");
const realOpen = fsp.open;
fsp.open = (async (...args: Parameters<typeof realOpen>) => {
  if (stuckFiles.includes(String(args[0]))) await new Promise(() => {});
  if (mode === "reopen" && String(args[0]) === join(projectDir!, "index.html"))
    process.kill(process.pid, "SIGKILL");
  return realOpen(...args);
}) as typeof realOpen;
const realRename = fs.renameSync;
fs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
  realRename(from, to);
  if (mode === "reopen-list" && String(to).endsWith("went-ahead.json"))
    process.kill(process.pid, "SIGKILL");
}) as typeof realRename;
syncBuiltinESMExports();

const { openProjectHistory } = await import("../projectHistory.js");
const history = await openProjectHistory({
  projectDir: projectDir!,
  historyRoot: historyRoot!,
  firstCopyFileMs: 100,
  now: () => Date.now() + 60_000,
  ...(closedWindow && { closedWindow: JSON.parse(closedWindow) }),
});
const agent = { kind: "agent", name: "Framey" } as const;
const index = join(projectDir!, "index.html");
if (mode === "earlier") {
  writeFileSync(index, "<html>first</html>");
  await history.claim({ kind: "person", name: "You" }, "First", [index]);
}
const step = await history.beginWindow(agent, "Step");
await new Promise((sent) => process.send!({ id: step.id }, sent));
for (const path of stuckFiles)
  if (mode === "delete") unlinkSync(path);
  else writeFileSync(path, "// agent\n");
writeFileSync(index, "<html>agent</html>");
for (const path of stuckFiles) history.noteChange(path);
history.noteChange(index);
if (mode !== "open") await step.close();
process.kill(process.pid, "SIGKILL");
