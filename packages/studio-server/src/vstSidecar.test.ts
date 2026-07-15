import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getVstSidecar, startVstSidecar, stopVstSidecar, __resetForTests } from "./vstSidecar";

afterEach(() => {
  __resetForTests();
  delete process.env.HF_VST_HOST_CMD;
});

function fakeServe(dir: string, lines: string): string {
  const script = join(dir, "fake-serve.sh");
  writeFileSync(script, `#!/bin/sh\n${lines}\n`);
  chmodSync(script, 0o755);
  return script;
}

/**
 * Polls for `path` to exist instead of a single fixed sleep — under CI
 * contention a fixed wait (the previous approach here) can fire before a
 * slow-to-schedule child process has actually written its PID file, flaking
 * the test. Polls quickly (10ms) since the common case resolves almost
 * immediately; `timeoutMs` is a generous ceiling, not the expected wait.
 */
async function waitForFile(path: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timed out waiting for ${path} to appear`);
}

describe("startVstSidecar", () => {
  it("resolves the announced port", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vst-cli-"));
    process.env.HF_VST_HOST_CMD = fakeServe(
      dir,
      `echo "VST-HOST-LISTENING port=9555 token=tok-9555"; sleep 60`,
    );
    const { port, stop } = await startVstSidecar();
    expect(port).toBe(9555);
    expect(getVstSidecar()?.port).toBe(9555);
    stop();
  });

  it("resolves the announced token alongside the port", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vst-cli-"));
    process.env.HF_VST_HOST_CMD = fakeServe(
      dir,
      `echo "VST-HOST-LISTENING port=9560 token=tok-9560"; sleep 60`,
    );
    const { token, stop } = await startVstSidecar();
    expect(token).toBe("tok-9560");
    stop();
  });

  it("is a singleton while running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vst-cli-"));
    process.env.HF_VST_HOST_CMD = fakeServe(
      dir,
      `echo "VST-HOST-LISTENING port=9556 token=tok-9556"; sleep 60`,
    );
    const a = await startVstSidecar();
    const b = await startVstSidecar();
    expect(b.port).toBe(a.port);
    expect(b.token).toBe(a.token);
    a.stop();
  });

  it("rejects with install hint when command is missing", async () => {
    process.env.HF_VST_HOST_CMD = "/definitely/not/here";
    await expect(startVstSidecar()).rejects.toThrow(/uv tool install hyperframes-vst-host/);
  });

  it("does not double-spawn when called concurrently before readiness", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vst-cli-"));
    const spawnLog = join(dir, "spawns.log");
    process.env.HF_VST_HOST_CMD = fakeServe(
      dir,
      `echo spawned >> "${spawnLog}"\nsleep 0.2\necho "VST-HOST-LISTENING port=9557 token=tok-9557"\nsleep 60`,
    );

    const p1 = startVstSidecar();
    const p2 = startVstSidecar();
    const [a, b] = await Promise.all([p1, p2]);

    expect(a.port).toBe(9557);
    expect(b.port).toBe(9557);

    const spawnCount = readFileSync(spawnLog, "utf8").trim().split("\n").filter(Boolean).length;
    expect(spawnCount).toBe(1);

    a.stop();
  });

  it("recovers after a failed spawn attempt so a later call can succeed", async () => {
    process.env.HF_VST_HOST_CMD = "/definitely/not/here-again";
    await expect(startVstSidecar()).rejects.toThrow(/uv tool install hyperframes-vst-host/);

    const dir = mkdtempSync(join(tmpdir(), "vst-cli-"));
    process.env.HF_VST_HOST_CMD = fakeServe(
      dir,
      `echo "VST-HOST-LISTENING port=9559 token=tok-9559"; sleep 60`,
    );
    const { port, stop } = await startVstSidecar();
    expect(port).toBe(9559);
    stop();
  });
});

describe("stopVstSidecar", () => {
  it("kills a sidecar that is still mid-spawn, before the ready handshake arrives", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vst-cli-"));
    const pidFile = join(dir, "child.pid");
    // Writes its own PID immediately, then simulates a slow real-world boot
    // (a real `uv run ... hyperframes-vst serve` can take over a second)
    // before ever printing the ready line.
    process.env.HF_VST_HOST_CMD = fakeServe(
      dir,
      `echo $$ > "${pidFile}"\nsleep 1\necho "VST-HOST-LISTENING port=9558 token=tok-9558"\nsleep 60`,
    );

    const startPromise = startVstSidecar();
    // This attempt is expected to be killed out from under it and reject;
    // swallow here so an unhandled-rejection warning doesn't fire before we
    // assert on it below.
    startPromise.catch(() => {});

    // Wait for the child to actually spawn and record its PID (rather than a
    // fixed sleep, which flakes under CI contention if scheduling the child
    // process takes longer than expected) — well inside the fake sidecar's
    // 1s boot delay, so stopVstSidecar() genuinely races the ready handshake
    // rather than the test's own timing.
    await waitForFile(pidFile);
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    expect(() => process.kill(pid, 0)).not.toThrow();

    stopVstSidecar();

    // Poll until the killed child actually exits.
    const deadline = Date.now() + 2000;
    let alive = true;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        alive = false;
        break;
      }
    }
    expect(alive).toBe(false);

    // The in-flight attempt settles (rejects) once its child is killed, and
    // clears its bookkeeping so a subsequent startVstSidecar() call isn't
    // stuck waiting on a dead attempt.
    await expect(startPromise).rejects.toThrow();
  }, 5000);
});
