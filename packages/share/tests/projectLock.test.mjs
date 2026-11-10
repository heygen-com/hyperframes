import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
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
});

test("a directory left empty during release does not block the next owner", async (t) => {
  const root = await project(t);
  const lock = join(root, ".hyperframes", "review-export.lock");
  await fs.mkdir(lock, { recursive: true });
  assert.equal(await withProjectShareLock(root, "export", async () => "recovered"), "recovered");
  await assert.rejects(fs.lstat(lock), { code: "ENOENT" });
});
