import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtemp, mkdir, readFile, writeFile, rm, symlink, utimes } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import {
  bindShareHost,
  shareForReview,
  reviewClient,
  reviewRecord,
  addVersion,
  pendingReviewExport,
  reviewVersion,
  refreshReviewExport,
  putFile,
  projectFingerprint,
  snapshotProject,
  snapshotFiles,
  snapshotFingerprint,
  withProjectShareLock,
  ShareBusyError,
} from "../src/index.mjs";

const reviewUploadOrigins = [
  "https://review-bucket.s3.us-east-1.amazonaws.com",
  "https://customer-bucket.s3.us-west-2.amazonaws.com",
];

bindShareHost({
  normalize: realpathSync,
  channelSite: "https://hyperframes.dev",
  signinSites: ["https://hyperframes.dev"],
  projectFingerprint,
  reviewUploadOrigins,
  latestExportFile: (dir) => ({
    path: join(dir, ".hyperframes", "video.mp4"),
    fingerprint: "rendered",
    id: "render",
  }),
});
async function folder(t) {
  const dir = await mkdtemp(join(tmpdir(), "hf-share-kernel-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function client() {
  let calls = 0;
  const body = [];
  const dto = {
    project_id: "p1",
    review_url: "https://hyperframes.dev/r/token",
    access_mode: "public",
    default_role: "commenter",
    comments_enabled: true,
    revoked: false,
  };
  return {
    body,
    calls: () => calls,
    spaces: async () => [{ space_id: "s1", bound: true, can_create_review: true }],
    register: async (value) => {
      calls++;
      body.push(value);
      return { project_id: "p1" };
    },
    signedInEmail: async () => "owner@example.com",
    share: async () => dto,
  };
}
test("a lost registration response retries the persisted operation and identity", async (t) => {
  const dir = await folder(t);
  const api = client();
  const register = api.register;
  let first = true;
  api.register = async (value) => {
    const result = await register(value);
    if (first) {
      first = false;
      throw new Error("lost reply");
    }
    return result;
  };
  await assert.rejects(
    shareForReview({ projectPath: dir, title: "Video", client: api, audience: "public" }),
  );
  await shareForReview({
    projectPath: dir,
    title: "Changed title",
    client: api,
    audience: "public",
  });
  assert.equal(api.calls(), 2);
  assert.deepEqual(api.body[0], api.body[1]);
  assert.equal((await reviewRecord(dir)).projectId, "p1");
});

test("preparing a review can fail before opening and retry its saved registration", async (t) => {
  const dir = await folder(t);
  const api = client();
  const read = api.share;
  api.share = async () => ({ ...(await read()), access_mode: "private" });
  const opened = [];
  api.updateShare = async (id, body) => {
    opened.push(id);
    return { ...(await read()), access_mode: body.access_mode };
  };
  const request = { projectPath: dir, title: "Review", client: api, audience: "public" };
  await assert.rejects(
    shareForReview({
      ...request,
      beforeOpen: async (id) => {
        assert.equal((await reviewRecord(dir)).projectId, id);
        throw new Error("Content unavailable");
      },
    }),
    /Content unavailable/,
  );
  assert.deepEqual(opened, []);
  assert.equal((await reviewRecord(dir)).opened, false);
  await shareForReview({
    ...request,
    beforeOpen: async (id) => {
      assert.equal(id, "p1");
      assert.deepEqual(opened, []);
    },
  });
  assert.deepEqual(opened, ["p1"]);
  assert.equal(api.calls(), 1);
  assert.equal((await reviewRecord(dir)).opened, true);
});

test("an already-open link returns status without rerunning content preparation", async (t) => {
  const dir = await folder(t);
  const api = client();
  const request = { projectPath: dir, title: "Review", client: api, audience: "public" };
  const first = await shareForReview(request);
  const again = await shareForReview({
    ...request,
    beforeOpen: async () => {
      throw new Error("Content temporarily unavailable");
    },
  });
  assert.deepEqual(again, first);
  assert.equal(api.calls(), 1);
});

test("reopening a revoked link prepares content before enabling it and retries safely", async (t) => {
  const dir = await folder(t);
  const api = client();
  const request = { projectPath: dir, title: "Review", client: api, audience: "public" };
  await shareForReview(request);
  const read = api.share;
  api.share = async () => ({ ...(await read()), revoked: true, link_generation: 2 });
  const events = [];
  api.linkOn = async () => {
    events.push("open");
    return read();
  };
  await assert.rejects(
    shareForReview({
      ...request,
      beforeOpen: async () => {
        throw new Error("Content unavailable");
      },
    }),
    /Content unavailable/,
  );
  assert.deepEqual(events, []);
  await shareForReview({
    ...request,
    beforeOpen: async (id) => {
      assert.equal(id, "p1");
      events.push("prepare");
    },
  });
  assert.deepEqual(events, ["prepare", "open"]);
  assert.equal(api.calls(), 1);
});

test("a taken-down review does not prepare content or reopen its link", async (t) => {
  const dir = await folder(t);
  const api = client();
  const read = api.share;
  api.share = async () => ({
    ...(await read()),
    moderation_hold: true,
    moderation_hold_kind: "takedown",
    revoked: true,
  });
  const status = await shareForReview({
    projectPath: dir,
    title: "Review",
    client: api,
    beforeOpen: async () => assert.fail("A taken-down review cannot open"),
  });
  assert.equal(status.held, true);
  assert.equal((await reviewRecord(dir)).opened, false);
});

test("storyboard reads and composition binding use the signed-in review routes", async () => {
  const sent = [];
  const api = reviewClient({
    access: async () => ({ token: "t", heygen: "https://review.test", heygenApi: "" }),
    fetchImpl: async (url, init) => {
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer t");
      sent.push([init.method, new URL(url).pathname, new URL(url).search, init.body]);
      return Response.json({ data: {} });
    },
  });
  await api.storyboard("project/id");
  await api.bindComposition("project/id", "composition");
  assert.deepEqual(sent, [
    ["GET", "/v1/hyperframes/projects/project%2Fid/storyboard", "", null],
    [
      "PUT",
      "/v1/hyperframes/review-projects/project%2Fid/composition",
      "",
      '{"composition_id":"composition"}',
    ],
  ]);
});
test("corrupt identity fails instead of consuming a new share slot", async (t) => {
  const dir = await folder(t);
  await mkdir(join(dir, ".hyperframes"));
  await writeFile(join(dir, ".hyperframes/review.json"), "{broken");
  const api = client();
  await assert.rejects(
    shareForReview({ projectPath: dir, title: "Video", client: api, audience: "public" }),
    /Restore this file from a backup.*Keep the file/,
  );
  assert.equal(api.calls(), 0);
});
test("a completed identical upload is not added again after another host releases the lock", async (t) => {
  const dir = await folder(t);
  const api = client();
  await shareForReview({ projectPath: dir, title: "Video", client: api, audience: "public" });
  await writeFile(join(dir, ".hyperframes/video.mp4"), "video bytes");
  bindShareHost({ projectFingerprint: async () => "rendered" });
  let exports = 0;
  api.createExport = async () => {
    exports++;
    return {
      status: "ready",
      video_id: "vid",
      version_id: "v1",
      exported_at: "2026-11-04T00:00:00Z",
    };
  };
  api.project = async () => ({ latest_ready_version_id: "v1" });
  const request = {
    projectPath: dir,
    title: "Video",
    client: api,
    probe: async () => ({ width: 1920, height: 1080, duration: 1 }),
  };
  assert.equal(await addVersion(request), null);
  assert.equal(await addVersion(request), null);
  assert.equal(exports, 1);
  assert.equal((await reviewVersion(dir)).last.current, true);
  bindShareHost({ projectFingerprint });
});
test("HTML stamps and generated render metadata do not dirty the shared source", async (t) => {
  const dir = await folder(t);
  await writeFile(join(dir, "index.html"), "<div>Hello</div>");
  const before = await projectFingerprint(dir);
  await writeFile(join(dir, "index.html"), '<div data-hf-id="123">Hello</div>');
  await mkdir(join(dir, ".hyperframes"));
  await writeFile(join(dir, ".hyperframes/render.json"), "metadata");
  assert.equal(await projectFingerprint(dir), before);
  await writeFile(join(dir, "index.html"), '<div data-hf-id="123">Changed</div>');
  assert.notEqual(await projectFingerprint(dir), before);
});
test("a host can accept a version that is still screening when it stops waiting", async (t) => {
  const dir = await folder(t);
  const api = client();
  await shareForReview({ projectPath: dir, title: "Video", client: api, audience: "public" });
  await writeFile(join(dir, ".hyperframes/video.mp4"), "video bytes");
  bindShareHost({ projectFingerprint: async () => "rendered" });
  t.after(() => bindShareHost({ projectFingerprint }));
  let video = {
    status: "screening",
    screening_state: "held",
    video_id: "vid",
    version_id: "v1",
    exported_at: "2026-11-04T00:00:00Z",
  };
  api.createExport = t.mock.fn(async () => video);
  api.readExport = async () => video;
  const onAdded = t.mock.fn();
  const request = {
    projectPath: dir,
    title: "Video",
    client: api,
    probe: async () => ({ width: 1920, height: 1080, duration: 1 }),
    open: () => false,
    onAdded,
  };

  assert.ok(await addVersion(request));
  assert.equal((await reviewVersion(dir)).held, true);
  assert.equal(await addVersion({ ...request, allowPending: true }), null);
  assert.equal((await pendingReviewExport(dir)).videoId, "vid");
  assert.equal((await reviewVersion(dir)).failure, null);
  assert.equal(onAdded.mock.callCount(), 0);
  assert.equal(api.createExport.mock.callCount(), 1);

  video = { ...video, status: "ready" };
  await refreshReviewExport(dir, api);
  assert.equal(await pendingReviewExport(dir), null);
  assert.equal((await reviewVersion(dir)).last.current, true);
});
const moduleUrl = new URL("../src/index.mjs", import.meta.url).href;
function child(script, args) {
  return spawn(process.execPath, ["--input-type=module", "-e", script, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}
async function success(proc) {
  let stderr = "";
  proc.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const [code] = await once(proc, "exit");
  assert.equal(code, 0, stderr);
}
for (const fallback of [false, true])
  test(`independent processes serialize registration (exclusive-create=${fallback})`, async (t) => {
    const dir = await folder(t);
    const script = `import fs from 'node:fs/promises';
    if (${fallback}) fs.link = async () => { throw Object.assign(new Error('unsupported'), {code:'EPERM'}); };
    import {bindShareHost,shareForReview} from ${JSON.stringify(moduleUrl)};
    import {realpathSync} from 'node:fs'; import {appendFile} from 'node:fs/promises';
    const dir=process.argv[1]; bindShareHost({normalize:realpathSync,channelSite:'https://hyperframes.dev',signinSites:['https://hyperframes.dev']});
    const client={ spaces:async()=>[{space_id:'s1',bound:true,can_create_review:true}], signedInEmail:async()=>null,
      register:async()=>{await appendFile(dir+'/registrations','registered\\n');await new Promise(r=>setTimeout(r,80));return {project_id:'p1'}},
      share:async()=>({project_id:'p1',review_url:'https://hyperframes.dev/r/t',access_mode:'public',default_role:'commenter',comments_enabled:true,revoked:false})};
    await shareForReview({projectPath:dir,title:'Video',client,audience:'public'});`;
    await Promise.all([success(child(script, [dir])), success(child(script, [dir]))]);
    assert.equal(await readFile(join(dir, "registrations"), "utf8"), "registered\n");
  });
test("a dead local owner can resume while a live or foreign owner is never stolen", async (t) => {
  const dir = await folder(t);
  const script = `import {withProjectShareLock} from ${JSON.stringify(moduleUrl)}; await withProjectShareLock(process.argv[1], 'review', async()=>{console.log('locked');await new Promise(()=>{});setInterval(()=>{},1000)});`;
  // Keep the owner alive until the parent deliberately terminates this test process.
  const proc = child(
    script.replace(
      "await new Promise(()=>{});setInterval(()=>{},1000)",
      "await new Promise(()=>{setInterval(()=>{},1000)})",
    ),
    [dir],
  );
  await once(proc.stdout, "data");
  await assert.rejects(
    withProjectShareLock(dir, "review", async () => true, { timeoutMs: 30 }),
    ShareBusyError,
  );
  const ended = once(proc, "exit");
  proc.kill("SIGKILL");
  await ended;
  assert.equal(await withProjectShareLock(dir, "review", async () => "resumed"), "resumed");
  await writeFile(
    join(dir, ".hyperframes/review.lock"),
    JSON.stringify({ token: randomUUID(), pid: process.pid, hostname: hostname() + "-foreign" }),
  );
  await assert.rejects(
    withProjectShareLock(dir, "review", async () => true, { timeoutMs: 30 }),
    ShareBusyError,
  );
});

test("status recovery settles distinct video/version IDs without a new upload", async (t) => {
  const dir = await folder(t);
  const api = client();
  await shareForReview({ projectPath: dir, title: "Video", client: api, audience: "public" });
  const fingerprint = await projectFingerprint(dir);
  const file = join(dir, ".hyperframes/review-export.json");
  await writeFile(
    file,
    JSON.stringify({
      last: null,
      pending: {
        projectId: "p1",
        videoId: "video-id",
        body: {
          title_snapshot: "Video",
          coordinate_width: 1920,
          coordinate_height: 1080,
          duration_seconds: 1,
          render_settings: {},
          source_revision_id: null,
          source_fingerprint: fingerprint,
          local_upload: { checksum_sha256: "checksum", content_type: "video/mp4", size_bytes: 42 },
          client_operation_id: "stable",
        },
      },
    }),
  );
  const saved = await readFile(file, "utf8");
  let status = "upload_pending";
  let reads = 0;
  api.readExport = async (project, video) => {
    reads++;
    assert.equal(project, "p1");
    assert.equal(video, "video-id");
    return {
      status,
      video_id: video,
      version_id: "version-id",
      exported_at: "2026-11-04T00:00:00Z",
    };
  };
  await withProjectShareLock(dir, "export", () => refreshReviewExport(dir, api));
  assert.equal(reads, 0);
  await refreshReviewExport(dir, api);
  assert.equal(reads, 1);
  assert.equal(await readFile(file, "utf8"), saved);
  status = "ready";
  await refreshReviewExport(dir, api);
  assert.equal(reads, 2);
  assert.equal(JSON.parse(await readFile(file, "utf8")).pending, null);
  assert.equal(
    (await reviewVersion(dir, { latestReadyVersionId: "version-id" })).last.current,
    true,
  );
  await refreshReviewExport(dir, api);
  assert.equal(reads, 2);
});
test("refuses an unconfigured review upload destination before sending the file", async (t) => {
  const dir = await folder(t);
  const file = join(dir, "video.mp4");
  await writeFile(file, "rendered video");
  const fetchImpl = t.mock.fn(async () => new Response(null, { status: 200 }));
  for (const put_url of [
    "https://other-bucket.s3.us-east-1.amazonaws.com/video",
    "https://review-bucket.s3.us-east-1.amazonaws.com.example.test/video",
    `${reviewUploadOrigins[0]}:8443/video`,
    "http://127.0.0.1:8090/video",
    "not a URL",
  ]) {
    assert.equal(
      await putFile({ put_url, headers: {} }, file, 14, () => {}, { fetchImpl }),
      "refused",
      put_url,
    );
  }
  assert.equal(fetchImpl.mock.callCount(), 0);
});

test("streams a review video to a configured storage origin without following redirects", async (t) => {
  const dir = await folder(t);
  const file = join(dir, "video.mp4");
  const video = "rendered video";
  await writeFile(file, video);
  const put_url = `${reviewUploadOrigins[1]}/video?signature=example`;
  const fetchImpl = t.mock.fn(async (url, request) => {
    assert.equal(url.href, put_url);
    assert.equal(request.redirect, "manual");
    assert.equal(await new Response(request.body).text(), video);
    return new Response(null, {
      status: 307,
      headers: { location: "https://other.example.test/video" },
    });
  });
  assert.equal(
    await putFile({ put_url, headers: {} }, file, video.length, () => {}, { fetchImpl }),
    "refused",
  );
  assert.equal(fetchImpl.mock.callCount(), 1);
});

test("failed upload releases its input even when fetch does not cancel it", async (t) => {
  const dir = await folder(t);
  const file = join(dir, "video.mp4");
  await writeFile(file, Buffer.alloc(200_000));
  let reader;
  const result = await putFile(
    { put_url: `${reviewUploadOrigins[0]}/video`, headers: {} },
    file,
    200_000,
    () => {},
    {
      fetchImpl: async (_url, request) => {
        reader = request.body.getReader();
        await reader.read();
        throw new Error("network closed");
      },
    },
  );
  assert.equal(result, "offline");
  await assert.rejects(
    reader.read(),
    (error) => error.code === "ERR_STREAM_PREMATURE_CLOSE" || error.code === "ABORT_ERR",
  );
});

test("linked media changes invalidate the rendered source and link cycles terminate", async (t) => {
  const dir = await folder(t);
  const media = await folder(t);
  await writeFile(join(media, "clip.mp4"), "first video");
  await symlink(media, join(dir, "assets"), "dir");
  await symlink(dir, join(media, "cycle"), "dir");
  const before = await projectFingerprint(dir);
  await writeFile(join(media, "clip.mp4"), "updated video bytes");
  assert.notEqual(await projectFingerprint(dir), before);
});

for (const code of ["EPERM", "ENOTSUP", "EXDEV", "EINVAL", "EISDIR", "EACCES"]) {
  test(`directory fallback serializes operations when hard links fail with ${code}`, async (t) => {
    const dir = await folder(t);
    t.mock.method(fs, "link", async () => {
      throw Object.assign(new Error("unsupported"), { code });
    });
    let active = 0;
    let completed = 0;
    const run = () =>
      withProjectShareLock(dir, "review", async () => {
        assert.equal(++active, 1);
        await new Promise((resolve) => setTimeout(resolve, 40));
        active--;
        completed++;
      });
    await Promise.all([run(), run(), run()]);
    assert.equal(completed, 3);
    await assert.rejects(readFile(join(dir, ".hyperframes/review.lock")), { code: "ENOENT" });
  });
}
test("Desktop snapshots retain the original symlink-skipping fingerprint", async (t) => {
  const dir = await folder(t);
  const media = await folder(t);
  await writeFile(join(dir, "index.html"), "<div>Film</div>");
  const before = await snapshotProject(dir);
  await writeFile(join(media, "clip.mp4"), "first video");
  await symlink(media, join(dir, "footage"), "dir");
  await symlink(join(media, "clip.mp4"), join(dir, "clip.mp4"), "file");
  assert.deepEqual(await snapshotProject(dir), before);
  assert.deepEqual(await snapshotProject(dir, { byContent: true }), before);
  assert.equal(snapshotFingerprint(await snapshotProject(dir)), snapshotFingerprint(before));
  assert.equal((await snapshotProject(dir, { followSymlinks: true })).size, 3);
  assert.deepEqual(
    await snapshotFiles(dir, ["clip.mp4", "footage"]),
    new Map([
      ["clip.mp4", undefined],
      ["footage", undefined],
    ]),
  );
});

for (const name of ["review.json", "review-export.json", "review-switch.json"]) {
  test(`corrupt ${name} retains its bytes and explains recovery`, async (t) => {
    const { readJsonOr } = await import("../src/storage.mjs");
    const dir = await folder(t);
    const file = join(dir, name);
    await writeFile(file, "");
    await assert.rejects(readJsonOr(file, null), (error) => {
      assert.ok(error.message.includes(name));
      assert.match(error.message, /Restore this file from a backup/);
      assert.ok(error.cause instanceof SyntaxError);
      return true;
    });
    assert.equal(await readFile(file, "utf8"), "");
  });
}
test("required source never silently degrades after preparation or a server mismatch", async (t) => {
  const dir = await folder(t);
  await mkdir(join(dir, ".hyperframes"));
  await writeFile(join(dir, ".hyperframes/video.mp4"), "video");
  bindShareHost({ projectFingerprint: async () => "rendered" });
  t.after(() => bindShareHost({ projectFingerprint }));
  let creates = 0;
  const api = {
    createExport: async () => {
      creates++;
      throw new Error("should not send");
    },
  };
  const request = {
    projectPath: dir,
    title: "Video",
    client: api,
    projectId: "project",
    requireSource: true,
    probe: async () => ({ width: 100, height: 100, duration: 1 }),
    filesForExport: async () => null,
  };
  assert.match(await addVersion(request), /Source changed/);
  assert.equal(creates, 0);
  const { ReviewFailed } = await import("../src/reviewClient.mjs");
  api.createExport = async () => {
    creates++;
    throw new ReviewFailed(422, "snapshot_mismatch");
  };
  await addVersion({
    ...request,
    filesForExport: async () => ({
      space_id: "space",
      composition_id: "comp",
      snapshot_id: "snap",
    }),
  });
  assert.equal(creates, 1);
});

test("content fingerprints detect same-size changes with restored timestamps", async (t) => {
  const dir = await folder(t);
  const file = join(dir, "asset.txt");
  const time = new Date("2026-11-01T00:00:00Z");
  await writeFile(file, "first");
  await utimes(file, time, time);
  const metadata = await projectFingerprint(dir);
  const content = await projectFingerprint(dir, { byContent: true });
  await writeFile(file, "other");
  await utimes(file, time, time);
  assert.equal(await projectFingerprint(dir), metadata);
  assert.notEqual(await projectFingerprint(dir, { byContent: true }), content);
});

test("a video-only retry never replays an unanswered source-bearing export", async (t) => {
  const dir = await folder(t);
  await mkdir(join(dir, ".hyperframes"));
  await writeFile(join(dir, ".hyperframes/video.mp4"), "video bytes");
  bindShareHost({ projectFingerprint: async () => "rendered" });
  t.after(() => bindShareHost({ projectFingerprint }));
  let creates = 0;
  const request = {
    projectPath: dir,
    title: "Video",
    client: {
      createExport: async () => {
        creates++;
        throw new Error("lost response");
      },
    },
    projectId: "project",
    probe: async () => ({ width: 100, height: 100, duration: 1 }),
    filesForExport: async () => ({
      space_id: "space",
      composition_id: "composition",
      snapshot_id: "snapshot",
    }),
  };
  await addVersion({ ...request, requireSource: true });
  assert.match(
    await addVersion({ ...request, omitSource: true }),
    /pending upload includes source/,
  );
  assert.equal(creates, 1);
});
test("change detection keeps working when .hyperframesignore uses gitignore syntax", async (t) => {
  for (const rule of ["/renders/", "**/*.mov", "!keep.mp4", "assets/*/raw-*.mp4", "a[bc].png"]) {
    const dir = await folder(t);
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "index.html"), "<div>Hello</div>");
    await writeFile(join(dir, "assets/clip.mov"), "clip");
    await writeFile(join(dir, ".hyperframesignore"), `${rule}\n`);
    // The CLI's syntax is not this reader's: nothing is excluded beyond scratch, so a change still counts.
    const files = await snapshotProject(dir);
    assert.deepEqual([...files.keys()].sort(), ["assets/clip.mov", "index.html"], rule);
    // snapshotFiles names every file asked for; an excluded one is keyed undefined.
    assert.notEqual(
      (await snapshotFiles(dir, ["assets/clip.mov"])).get("assets/clip.mov"),
      undefined,
      rule,
    );
    const before = await projectFingerprint(dir);
    await writeFile(join(dir, "assets/clip.mov"), "edited clip");
    assert.notEqual(await projectFingerprint(dir), before, rule);
  }
});
test("change detection keeps working when .hyperframesignore is a link", async (t) => {
  const dir = await folder(t);
  await writeFile(join(dir, "index.html"), "<div>Hello</div>");
  await symlink(join(dir, "index.html"), join(dir, ".hyperframesignore"));
  assert.deepEqual([...(await snapshotProject(dir)).keys()], ["index.html"]);
});
test("change detection still applies a .hyperframesignore it can read", async (t) => {
  const dir = await folder(t);
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "index.html"), "<div>Hello</div>");
  await writeFile(join(dir, "assets/raw.mov"), "raw");
  await writeFile(join(dir, "debug.log"), "log");
  await writeFile(join(dir, ".hyperframesignore"), "assets/raw.mov\n");
  assert.deepEqual([...(await snapshotProject(dir)).keys()], ["index.html"]);
});
