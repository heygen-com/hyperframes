import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "downloadStall.fixture.ts");
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function runFixture(onConnection: (socket: Socket) => void, attempts?: number) {
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    // Windows resets the held socket when the child is killed; that is expected.
    socket.on("error", () => {});
    onConnection(socket);
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as { port: number };
  const home = mkdtempSync(join(tmpdir(), "hf-download-stall-"));
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      fixturePath,
      `http://127.0.0.1:${port}`,
      ...(attempts ? [String(attempts)] : []),
    ],
    {
      env: { ...process.env, HOME: home, USERPROFILE: home, HYPERFRAMES_BROWSER_PATH: "" },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  cleanups.push(() => {
    child.kill("SIGKILL");
    for (const socket of sockets) socket.destroy();
    server.close();
    rmSync(home, { recursive: true, force: true });
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const code = await new Promise<number | null>((resolve) => {
    const giveUp = setTimeout(() => resolve(null), 110_000);
    child.once("exit", (exitCode) => {
      clearTimeout(giveUp);
      resolve(exitCode);
    });
  });
  return { code, stderr, port, home };
}

it("exits with code 1 when the download host accepts the connection and never answers", async () => {
  const run = await runFixture(() => {}, 3);

  expect(run.code).toBe(1);
  expect(run.stderr).toContain(`The Chrome download from 127.0.0.1:${run.port} stalled`);
  expect(run.stderr).toContain("Retrying (2/2)");
  expect(existsSync(join(run.home, ".cache", "hyperframes", ".chrome.install.lock"))).toBe(false);
}, 120_000);

it("gives up after the first stall when not on a terminal, naming the env var and doctor", async () => {
  const run = await runFixture(() => {});

  expect(run.code).toBe(1);
  expect(run.stderr).toContain(`The Chrome download from 127.0.0.1:${run.port} stalled`);
  expect(run.stderr).not.toContain("Retrying");
  expect(run.stderr).toContain("HYPERFRAMES_BROWSER_PATH");
  expect(run.stderr).toContain("hyperframes doctor");
}, 120_000);
