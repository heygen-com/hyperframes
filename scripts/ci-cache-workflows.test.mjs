import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const root = join(import.meta.dirname, "..");
const workflowsDir = join(root, ".github", "workflows");
const load = (path) => parse(readFileSync(path, "utf8"));
const workflows = readdirSync(workflowsDir)
  .filter((file) => /\.ya?ml$/.test(file))
  .map((file) => ({ file, doc: load(join(workflowsDir, file)) }));
const cacheWrites = (list) =>
  list.flatMap(({ file, doc }) =>
    Object.entries(doc.jobs ?? {}).flatMap(([name, job]) =>
      (job.steps ?? [])
        .map((step) => String(step.with?.["cache-to"] ?? ""))
        .filter((to) => to.includes("type=gha"))
        .map((to) => ({ id: `${file} ${name}`, to, matrix: Boolean(job.strategy?.matrix) })),
    ),
  );

// The Actions cache holds 10 GB. Per-PR exports evicted the bun cache; every shard of a main push
// exporting its own copy of the same layers evicted the release's prebuilt ffmpeg.
test("one job of a push to main writes each image cache", () => {
  const writes = cacheWrites(workflows);
  const ids = (list) => list.map((w) => w.id);
  assert.deepEqual(ids(writes.filter((w) => !w.to.includes("github.event_name == 'push'"))), []);
  assert.deepEqual(
    ids(writes.filter((w) => w.matrix && !w.to.includes("strategy.job-index == 0"))),
    [],
  );
  const scopes = writes.map((w) => w.to.match(/scope=([\w-]+)/)?.[1]);
  assert.deepEqual(scopes, [...new Set(scopes)]);
});

test("preflight installs without downloading ffmpeg or Chrome", () => {
  const steps = load(join(root, ".github", "actions", "preflight", "action.yml")).runs.steps;
  const ffmpeg = steps.findIndex((step) => step.uses === "./.github/actions/prepare-ffmpeg-bin");
  const install = steps.findIndex((step) => /\bbun install\b/.test(step.run ?? ""));
  assert.ok(install >= 0, "preflight runs bun install");
  assert.ok(ffmpeg >= 0 && ffmpeg < install, "prepare-ffmpeg-bin runs before bun install");
  assert.equal(steps[install].env?.PUPPETEER_SKIP_DOWNLOAD, "true");
});
