import { outputWritten, registerRootExitRequester, scheduleCliExit } from "./commandResult.js";

registerRootExitRequester((exitCode) => void outputWritten().then(() => process.exit(exitCode)));
setInterval(function stalledLookup() {}, 1_000);
console.log(JSON.stringify({ title: "x".repeat(1024 * 1024) }));
scheduleCliExit(0);
