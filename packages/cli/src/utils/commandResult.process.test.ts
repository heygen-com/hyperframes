import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "commandResult.fixture.ts");

it("a forced exit still hands a slow reader the whole result", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", fixture], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  onTestFinished(() => void child.kill("SIGKILL"));
  let printed = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    printed += chunk;
    child.stdout.pause();
    setTimeout(() => child.stdout.resume(), 100);
  });
  const exitCode = await new Promise((resolve) => child.once("close", resolve));
  expect(exitCode).toBe(0);
  expect((JSON.parse(printed) as { title: string }).title).toHaveLength(1024 * 1024);
}, 60_000);
