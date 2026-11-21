import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addVersion, bindShareHost, recheckHeld, reviewClient } from "../src/index.mjs";

const site = "https://hyperframes.dev";
const session = (token) => ({ token, heygen: site, heygenApi: site });
const exportDto = {
  video_id: "video",
  version_id: "version",
  exported_at: "2026-11-04T00:00:00Z",
};

async function makeProject(t) {
  const dir = await mkdtemp(join(tmpdir(), "hf-share-attribution-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const metadata = join(dir, ".hyperframes");
  await mkdir(metadata);
  const render = join(metadata, "video.mp4");
  await writeFile(render, "rendered video");
  await writeFile(
    join(metadata, "review.json"),
    JSON.stringify({ studioProjectId: "studio", projectId: "project", opened: true }),
  );
  bindShareHost({
    normalize: realpathSync,
    channelSite: site,
    projectFingerprint: async () => "rendered",
    latestExportFile: () => ({ path: render, fingerprint: "rendered", id: "render" }),
  });
  return {
    dir,
    render,
    state: () => readFile(join(metadata, "review-export.json"), "utf8").then(JSON.parse),
    request: {
      projectPath: dir,
      title: "Video",
      probe: async () => ({ width: 1920, height: 1080, duration: 1 }),
    },
  };
}

test("an authenticated export retry sends a fresh mark and clears only the accepted mark", async (t) => {
  const project = await makeProject(t);
  let timestamp = 100;
  let value = "no";
  const sent = [];
  const published = t.mock.fn(async () => {});
  const onAdded = t.mock.fn();
  const client = reviewClient({
    access: async (refused) => {
      if (refused) {
        assert.equal(refused, "first");
        timestamp = 200;
        value = "yes";
      }
      return session(refused ? "second" : "first");
    },
    fetchImpl: async (_url, init) => {
      sent.push({
        token: init.headers.authorization,
        body: JSON.parse(init.body),
        cutoff: (await project.state()).pending.reviewSent?.since,
      });
      if (sent.length === 1) return new Response(null, { status: 401 });
      return Response.json({ data: { ...exportDto, status: "ready" } });
    },
  });
  const fromReview = { now: () => timestamp, read: async () => value, published };

  assert.equal(await addVersion({ ...project.request, client, fromReview, onAdded }), null);
  assert.deepEqual(
    sent.map(({ token, body }) => [token, body.from_review]),
    [
      ["Bearer first", "no"],
      ["Bearer second", "yes"],
    ],
  );
  assert.equal(sent[0].body.client_operation_id, sent[1].body.client_operation_id);
  assert.deepEqual(
    sent.map(({ cutoff }) => cutoff),
    [100, 200],
  );
  assert.equal(published.mock.callCount(), 1);
  assert.deepEqual(published.mock.calls[0].arguments, [project.dir, 200]);
  assert.deepEqual(onAdded.mock.calls[0].arguments, [
    { files: false, first: true, fromReview: "yes" },
  ]);
});

for (const refusedRetry of [false, true]) {
  test(`a lost accepted export reply preserves later feedback (intervening 401: ${refusedRetry})`, async (t) => {
    const project = await makeProject(t);
    let timestamp = 100;
    const activity = [];
    const sent = [];
    const accepted = new Map();
    const published = t.mock.fn(async (_dir, cutoff) => {
      while (activity.length && activity[0] <= cutoff) activity.shift();
    });
    const onAdded = t.mock.fn();
    const client = reviewClient({
      access: async () => session("token"),
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        sent.push({ body, mark: (await project.state()).pending.reviewSent });
        if (refusedRetry && sent.length === 2) return new Response(null, { status: 401 });
        const key = body.client_operation_id;
        if (!accepted.has(key)) {
          accepted.set(key, { ...exportDto, version_id: key, status: "ready" });
        }
        if (sent.length === 1) throw new Error("Accepted, but the response was lost");
        return Response.json({ data: accepted.get(key) });
      },
    });
    const fromReview = {
      now: () => timestamp,
      read: async () => (activity.length ? "yes" : "no"),
      published,
    };
    const request = { ...project.request, client, fromReview, onAdded };

    assert.notEqual(await addVersion(request), null);
    activity.push(150);
    timestamp = 200;
    if (refusedRetry) assert.notEqual(await addVersion(request), null);
    assert.equal(await addVersion(request), null);

    const firstOperation = sent[0].body.client_operation_id;
    assert.ok(sent.every(({ body }) => body.client_operation_id === firstOperation));
    assert.deepEqual(
      sent.map(({ body }) => body.from_review),
      refusedRetry ? ["no", "yes", "yes"] : ["no", "yes"],
    );
    assert.ok(sent.every(({ mark }) => mark?.since === 100));
    assert.deepEqual(published.mock.calls[0].arguments, [project.dir, 100]);
    assert.deepEqual(onAdded.mock.calls[0].arguments, [{ files: false, first: true }]);
    assert.deepEqual(activity, [150]);

    timestamp = 300;
    await writeFile(project.render, "next rendered video");
    assert.equal(await addVersion(request), null);
    assert.notEqual(sent.at(-1).body.client_operation_id, firstOperation);
    assert.equal(sent.at(-1).body.from_review, "yes");
    assert.deepEqual(published.mock.calls[1].arguments, [project.dir, 300]);
    assert.deepEqual(onAdded.mock.calls[1].arguments, [
      { files: false, first: false, fromReview: "yes" },
    ]);
    assert.deepEqual(activity, []);
  });
}

test("approval of a held version clears its persisted review mark", async (t) => {
  const project = await makeProject(t);
  const published = t.mock.fn(async () => {});
  const fromReview = { now: () => 100, read: async () => "yes", published };
  const client = {
    createExport: async (_id, prepare) => {
      assert.equal((await prepare()).from_review, "yes");
      return { ...exportDto, status: "screening", screening_state: "held" };
    },
    readExport: async () => ({ ...exportDto, status: "ready" }),
  };

  await addVersion({ ...project.request, client, fromReview, open: () => false });
  const { pending } = await project.state();
  assert.deepEqual(pending.reviewSent, { since: 100, value: "yes" });
  assert.equal(pending.body.from_review, undefined);
  assert.equal(published.mock.callCount(), 0);
  await recheckHeld(project.dir, client, fromReview);
  assert.equal((await project.state()).pending, null);
  assert.equal(published.mock.callCount(), 1);
  assert.deepEqual(published.mock.calls[0].arguments, [project.dir, 100]);
});

test("title updates send the current title precondition on the authenticated project route", async () => {
  const client = reviewClient({
    access: async () => session("token"),
    fetchImpl: async (url, init) => {
      assert.equal(new URL(url).pathname, "/v1/hyperframes/review-projects/project");
      assert.equal(init.method, "PATCH");
      assert.equal(init.headers.authorization, "Bearer token");
      assert.deepEqual(JSON.parse(init.body), { title: "New", expected_title: "Old" });
      return Response.json({ data: { title: "New" } });
    },
  });
  assert.deepEqual(await client.updateTitle("project", { title: "New", expected_title: "Old" }), {
    title: "New",
  });
});
