import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { bindShareHost, changeSpace, retryOldLink } from "../src/index.mjs";
import { readReviewSwitch, reviewSwitchPath, sealedSwitch } from "../src/reviewShare.mjs";

bindShareHost({
  normalize: realpathSync,
  channelSite: "https://hyperframes.dev",
  signinSites: ["https://hyperframes.dev"],
});

/** A switched change whose old link is still to turn off: what a status read's cleanup acts on. */
const change = {
  id: "c1",
  from: "proj_old",
  spaceId: "sp_team",
  space: "Team",
  projectId: "proj_new",
  opened: true,
  audience: "public",
  body: { studio_project_id: "studio_1", title: "Launch", client_operation_id: "space-abcdefgh" },
};

async function project() {
  const dir = await mkdtemp(join(tmpdir(), "hf-switch-seal-"));
  await mkdir(join(dir, ".hyperframes"));
  await writeFile(
    join(dir, ".hyperframes", "review.json"),
    JSON.stringify({ projectId: "proj_new", studioProjectId: "studio_1", opened: true }),
  );
  return dir;
}

/** A client that fails the test on any request. */
const noRequests = /** @type {any} */ (
  new Proxy({}, { get: (_, name) => () => assert.fail(`no request expected, got ${String(name)}`) })
);

test("with the host's key, a journal another party wrote counts as none, and a read sends nothing", async () => {
  bindShareHost({ journalKey: randomBytes(32) });
  const dir = await project();
  await writeFile(reviewSwitchPath(dir), JSON.stringify(change));
  assert.equal(await readReviewSwitch(dir), null);
  await retryOldLink({ projectPath: dir, client: noRequests });
  assert.deepEqual(
    JSON.parse(await readFile(reviewSwitchPath(dir), "utf8")),
    change,
    "left as found",
  );
});

test("a sealed journal reads back as written; a changed byte, another key or another folder reads as none", async () => {
  const key = randomBytes(32);
  bindShareHost({ journalKey: key });
  const dir = await project();
  const sealed = sealedSwitch(dir, change);
  await writeFile(reviewSwitchPath(dir), JSON.stringify(sealed));
  assert.deepEqual(await readReviewSwitch(dir), change);

  await writeFile(reviewSwitchPath(dir), JSON.stringify({ ...sealed, audience: "team" }));
  assert.equal(await readReviewSwitch(dir), null, "a changed audience");

  const other = await project();
  await writeFile(reviewSwitchPath(other), JSON.stringify(sealed));
  assert.equal(await readReviewSwitch(other), null, "copied into another folder");

  await writeFile(reviewSwitchPath(dir), JSON.stringify(sealed));
  bindShareHost({ journalKey: randomBytes(32) });
  assert.equal(await readReviewSwitch(dir), null, "another install's key");
  bindShareHost({ journalKey: key });
  assert.deepEqual(await readReviewSwitch(dir), change);
});

test("a host with no key reads a journal as it is", async () => {
  bindShareHost({ journalKey: undefined });
  const dir = await project();
  await writeFile(reviewSwitchPath(dir), JSON.stringify(change));
  assert.deepEqual(await readReviewSwitch(dir), change);
  assert.deepEqual(sealedSwitch(dir, change), change);
});

test("an earlier journal of this install written back once the record is on the new project opens nothing", async () => {
  bindShareHost({ journalKey: randomBytes(32) });
  const dir = await project();
  // Mid-switch, as the kernel left it before the new link opened; the record has since moved on to proj_new.
  const { opened: _opened, ...midSwitch } = change;
  await writeFile(reviewSwitchPath(dir), JSON.stringify(sealedSwitch(dir, midSwitch)));
  assert.deepEqual(await readReviewSwitch(dir), midSwitch, "sealed by this install");
  await retryOldLink({ projectPath: dir, client: noRequests });
});

test("a press to move the review drops an earlier journal written back, turning no link on or off", async () => {
  bindShareHost({ journalKey: randomBytes(32) });
  const dir = await project();
  const { opened: _opened, ...midSwitch } = change;
  await writeFile(reviewSwitchPath(dir), JSON.stringify(sealedSwitch(dir, midSwitch)));
  /** @type {string[]} */
  const writes = [];
  const write = (/** @type {string} */ name) => async () => void writes.push(name);
  const client = /** @type {any} */ ({
    share: async () => ({ revoked: true, link_generation: 1, space: { space_id: "sp_old" } }),
    spaces: async () => [],
    linkOn: write("linkOn"),
    updateShare: write("updateShare"),
    linkOff: write("linkOff"),
  });
  const refused = await changeSpace({
    projectPath: dir,
    title: "Launch",
    client,
    spaceId: "sp_team",
    upload: async () => assert.fail("nothing to upload"),
    canUpload: async () => null,
  }).then(
    () => null,
    (error) => error,
  );
  assert.deepEqual(writes, [], "no link turned on, opened up or off");
  assert.equal(refused?.reason, "space_forbidden");
  assert.equal(await readReviewSwitch(dir), null, "the written-back journal is dropped");
});
