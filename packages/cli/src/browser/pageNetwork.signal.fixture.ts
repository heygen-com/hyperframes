// fallow-ignore-file unused-file
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import type { Browser } from "puppeteer-core";
import { registerRootExitRequester } from "../utils/commandResult.js";
import { onStopSignal } from "./launch.js";
import { launchWithPageNetwork } from "./pageNetwork.js";

const [readyPath] = process.argv.slice(2);
if (!readyPath) throw new Error("Missing fixture arguments");

process.env.PRODUCER_RESTRICT_PAGE_NETWORK = "true";
registerRootExitRequester((exitCode) => process.exit(exitCode));
// A command's own Chrome launch installs the CLI's signal handling; this stands in for it.
onStopSignal(() => {});

const events = new EventEmitter();
const connectedUntilStopped = {
  connected: true,
  once: (event: string, listener: () => void) => events.once(event, listener),
} as unknown as Browser;

await launchWithPageNetwork("http://127.0.0.1:4000/", async (network) => {
  writeFileSync(readyPath, JSON.stringify({ userDataDir: network.userDataDir }));
  return connectedUntilStopped;
});
