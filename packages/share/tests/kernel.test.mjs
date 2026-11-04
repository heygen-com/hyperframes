import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import {
  bindShareHost,
  shareForReview,
  reviewRecord,
  addVersion,
  reviewVersion,
  refreshReviewExport,
  putFile,
  projectFingerprint,
  withProjectShareLock,
  ShareBusyError,
} from "../src/index.mjs";

bindShareHost({
  normalize: realpathSync,
  channelSite: "https://hyperframes.dev",
  signinSites: ["https://hyperframes.dev"],
  projectFingerprint,
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
test("corrupt identity fails instead of consuming a new share slot", async (t) => {
  const dir = await folder(t);
  await mkdir(join(dir, ".hyperframes"));
  await writeFile(join(dir, ".hyperframes/review.json"), "{broken");
  const api = client();
  await assert.rejects(
    shareForReview({ projectPath: dir, title: "Video", client: api, audience: "public" }),
    SyntaxError,
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
test("independent processes serialize registration of the same folder", async (t) => {
  const dir = await folder(t);
  const script = `import {bindShareHost,shareForReview} from ${JSON.stringify(moduleUrl)};
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
          source_fingerprint: fingerprint,
          local_upload: { checksum_sha256: "checksum" },
          client_operation_id: "stable",
        },
      },
    }),
  );
  let reads = 0;
  api.readExport = async (project, video) => {
    reads++;
    assert.equal(project, "p1");
    assert.equal(video, "video-id");
    return {
      status: "ready",
      video_id: video,
      version_id: "version-id",
      exported_at: "2026-11-04T00:00:00Z",
    };
  };
  await withProjectShareLock(dir, "export", () => refreshReviewExport(dir, api));
  assert.equal(reads, 0);
  await refreshReviewExport(dir, api);
  assert.equal(reads, 1);
  assert.equal(JSON.parse(await readFile(file, "utf8")).pending, null);
  assert.equal(
    (await reviewVersion(dir, { latestReadyVersionId: "version-id" })).last.current,
    true,
  );
  await refreshReviewExport(dir, api);
  assert.equal(reads, 1);
});
test("failed upload releases its input even when fetch does not cancel it", async (t) => {
  const dir = await folder(t);
  const file = join(dir, "video.mp4");
  await writeFile(file, Buffer.alloc(200_000));
  let reader;
  const result = await putFile(
    { put_url: "https://storage.example/video", headers: {} },
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
