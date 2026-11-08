// A project's first history open, killed outright mid-copy with one copy half written.
import { writeFileSync } from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

const [projectDir, historyRoot, dieAtWrite] = process.argv.slice(2);
const realWriteFile = fsp.writeFile;
let writes = 0;
fsp.writeFile = ((...args: Parameters<typeof realWriteFile>) => {
  if (String(args[0]).includes("incoming-") && ++writes === Number(dieAtWrite)) {
    writeFileSync(String(args[0]), "half a co");
    process.kill(process.pid, "SIGKILL");
  }
  return realWriteFile(...args);
}) as typeof realWriteFile;
syncBuiltinESMExports();

const { openProjectHistory } = await import("../projectHistory.js");
await openProjectHistory({ projectDir: projectDir!, historyRoot: historyRoot! });
