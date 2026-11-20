// Reads the registry as the CLI does, with the CLI's env-proxy setup, and prints how it ended.
import "../utils/envProxyFetch.js";
import { readRegistryManifest } from "./remote.js";

const started = Date.now();
await readRegistryManifest("https://registry.proxy-fixture.com/registry", { skipCache: true }).then(
  () => process.stdout.write("read\n"),
  () => process.stdout.write(`failed after ${Date.now() - started} ms\n`),
);
