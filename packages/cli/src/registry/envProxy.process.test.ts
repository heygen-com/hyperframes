import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "envProxy.fixture.ts");

// fails without the fix: Node's own env proxy reconnects with no pause when the proxy drops the tunnel, so one
// registry read opened thousands of connections a second and the process outlived its own error.
it("a registry read through an env proxy that drops the tunnel fails once and the process ends", async () => {
  let tunnels = 0;
  const proxy = createServer((_, res) => res.writeHead(502).end());
  proxy.on("connect", (_, client) => {
    tunnels++;
    client.destroy();
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => void proxy.close());
  const url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  const home = mkdtempSync(join(tmpdir(), "hf-env-proxy-"));
  onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["--import", "tsx", fixture], {
    env: {
      ...process.env,
      HOME: home,
      HYPERFRAMES_CACHE_DIR: home,
      HTTPS_PROXY: url,
      HTTP_PROXY: url,
      NO_PROXY: "",
      NODE_USE_ENV_PROXY: "1",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  onTestFinished(() => void child.kill("SIGKILL"));
  setTimeout(() => child.kill("SIGKILL"), 8_000).unref();
  let printed = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => (printed += chunk));
  const ended = await new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve(code ?? signal)),
  );
  expect(printed).toMatch(/^failed after \d+ ms/);
  expect(Number(printed.match(/\d+/)?.[0])).toBeLessThan(2_000);
  expect(ended).toBe(0);
  expect(tunnels).toBeLessThanOrEqual(2);
}, 30_000);
