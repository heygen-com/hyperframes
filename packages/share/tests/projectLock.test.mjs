import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { ShareBusyError, withProjectShareLock } from "../src/projectLock.mjs";

const lockModule = new URL("../src/projectLock.mjs", import.meta.url).href;
const pausedAcquisition = `
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const [moduleUrl, root, lock] = process.argv.slice(1);
fs.link = async () => { throw Object.assign(new Error("unsupported"), { code: "ENOTSUP" }); };
const pause = async () => {
  process.send("published");
  await new Promise((resolve) => process.once("message", resolve));
};
const open = fs.open;
fs.open = async (...args) => {
  const handle = await open(...args);
  if (args[0] === lock) await pause();
  return handle;
};
const rename = fs.rename;
fs.rename = async (...args) => {
  await rename(...args);
  if (args[1] === lock) await pause();
};
syncBuiltinESMExports();
const { withProjectShareLock } = await import(moduleUrl);
await withProjectShareLock(root, "review", () => { throw new Error("owner should still be paused"); });
`;

async function project(t) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "share-project-lock-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.mock.method(fs, "link", async () => {
    throw Object.assign(new Error("unsupported"), { code: "ENOTSUP" });
  });
  return root;
}

async function exitedPid() {
  const child = spawn(process.execPath, ["-e", ""]);
  assert.deepEqual(await once(child, "exit"), [0, null]);
  return child.pid;
}

async function ownerDirectory(path, owner) {
  await fs.mkdir(path, { recursive: true });
  const marker = join(path, `${owner.token}.json`);
  await fs.writeFile(marker, JSON.stringify(owner));
  return marker;
}

test(
  "a paused fallback owner is exclusive, and a kill at publication allows recovery",
  { timeout: 10_000 },
  async (t) => {
    const root = await project(t);
    const lock = join(root, ".hyperframes", "review.lock");
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", pausedAcquisition, lockModule, root, lock],
      {
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      },
    );
    const exited = once(child, "exit");
    try {
      const [message] = await Promise.race([
        once(child, "message"),
        exited.then(([code, signal]) => assert.fail(`lock owner exited early: ${code ?? signal}`)),
      ]);
      assert.equal(message, "published");
      await assert.rejects(
        withProjectShareLock(
          root,
          "review",
          () => assert.fail("paused owner still holds the lock"),
          {
            timeoutMs: 0,
          },
        ),
        ShareBusyError,
      );
    } finally {
      child.kill("SIGKILL");
      await exited;
    }

    let active = 0;
    const run = () =>
      withProjectShareLock(
        root,
        "review",
        async () => {
          assert.equal(++active, 1);
          await setTimeout(25);
          active--;
        },
        { timeoutMs: 3000 },
      );
    await Promise.all([run(), run()]);
    await assert.rejects(fs.lstat(lock), { code: "ENOENT" });
  },
);

test("fallback leaves an empty legacy lock file alone", async (t) => {
  const root = await project(t);
  const folder = join(root, ".hyperframes");
  const lock = join(folder, "review.lock");
  await fs.mkdir(folder);
  await fs.writeFile(lock, "");
  await assert.rejects(
    withProjectShareLock(root, "review", () => assert.fail("legacy writer may still be alive"), {
      timeoutMs: 0,
    }),
    ShareBusyError,
  );
  assert.equal(await fs.readFile(lock, "utf8"), "");
  assert.deepEqual(await fs.readdir(folder), ["review.lock"]);
});

test("a directory left empty during release does not block the next owner", async (t) => {
  const root = await project(t);
  const lock = join(root, ".hyperframes", "review-export.lock");
  await fs.mkdir(lock, { recursive: true });
  assert.equal(await withProjectShareLock(root, "export", async () => "recovered"), "recovered");
  await assert.rejects(fs.lstat(lock), { code: "ENOENT" });
});

test("a delayed reaper cannot remove a replacement owner's directory", async (t) => {
  const root = await project(t);
  const lock = join(root, ".hyperframes", "review.lock");
  const stale = { token: randomUUID(), pid: await exitedPid(), hostname: hostname() };
  const live = { token: randomUUID(), pid: process.pid, hostname: hostname() };
  const staleMarker = await ownerDirectory(lock, stale);
  const replacement = join(root, "replacement");
  await ownerDirectory(replacement, live);

  const readFile = fs.readFile;
  const read = t.mock.method(fs, "readFile", async (path, ...args) => {
    const contents = await readFile(path, ...args);
    if (path === staleMarker) {
      await fs.unlink(staleMarker);
      await fs.rmdir(lock);
      await fs.rename(replacement, lock);
    }
    return contents;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      withProjectShareLock(root, "review", () => assert.fail("replacement owner holds the lock"), {
        timeoutMs: 100,
      }),
      ShareBusyError,
    );
  } finally {
    read.mock.restore();
    syncBuiltinESMExports();
  }
  assert.deepEqual(JSON.parse(await fs.readFile(join(lock, `${live.token}.json`), "utf8")), live);
});

test("legacy files and fallback directories respect a foreign owner with a dead local PID", async (t) => {
  const root = await project(t);
  const lock = join(root, ".hyperframes", "review.lock");
  const owner = { token: randomUUID(), pid: await exitedPid(), hostname: hostname() + "-foreign" };
  await fs.mkdir(join(root, ".hyperframes"));
  await fs.writeFile(lock, JSON.stringify(owner));
  for (const marker of [lock, join(lock, `${owner.token}.json`)]) {
    if (marker !== lock) {
      await fs.unlink(lock);
      await ownerDirectory(lock, owner);
    }
    await assert.rejects(
      withProjectShareLock(root, "review", () => assert.fail("foreign owner holds the lock"), {
        timeoutMs: 100,
      }),
      ShareBusyError,
    );
    assert.deepEqual(JSON.parse(await fs.readFile(marker, "utf8")), owner);
  }
});

test("Windows retries a transient fallback rename failure while the lock path is absent", async (t) => {
  const root = await project(t);
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32" });
  t.after(() => Object.defineProperty(process, "platform", platform));
  const rename = fs.rename;
  const denied = Object.assign(new Error("open handle on the draft"), { code: "EPERM" });
  const attempt = t.mock.method(fs, "rename", async (from, to) => {
    if (attempt.mock.callCount() === 0) throw denied;
    await rename(from, to);
  });
  await assert.equal(
    await withProjectShareLock(root, "review", async () => "acquired"),
    "acquired",
  );
  assert.equal(attempt.mock.callCount(), 2);
  t.mock.method(fs, "rename", async () => {
    throw denied;
  });
  await assert.rejects(
    withProjectShareLock(root, "review", () => assert.fail("rename never succeeds"), {
      timeoutMs: 0,
    }),
    denied,
  );
});
