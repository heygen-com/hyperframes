import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const workflow = parse(
  readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8"),
);
const names = [
  "hyperframes-lambda-handler.zip",
  "hyperframes-lambda-handler.sha256",
  "hyperframes-lambda-video-arm64.oci.tar",
  "hyperframes-lambda-video-arm64.sha256",
];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const step = (name, job = "publish") => workflow.jobs[job].steps.find((s) => s.name === name);

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "hf-release-receipt-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of [
    "bin",
    "release-bundle/assets",
    "release-receipt",
    "dist/lambda-handler-build",
  ])
    mkdirSync(join(root, dir), { recursive: true });
  for (const name of names)
    writeFileSync(join(root, "release-bundle/assets", name), `built ${name}`);
  writeFileSync(join(root, "dist/lambda-handler-build/handler.zip"), "built zip");
  const statePath = join(root, "state.json");
  const initial = { release: null, assets: [], calls: [], artifacts: [], failUpload: null };
  writeFileSync(statePath, JSON.stringify(initial));
  // Only this offline stub can service gh calls. No credentials or real network calls.
  writeFileSync(
    join(root, "bin/gh"),
    `#!${process.execPath}
const fs = require('node:fs'); const crypto = require('node:crypto');
const state = JSON.parse(fs.readFileSync(process.env.STATE_FILE, 'utf8'));
const args = process.argv.slice(2); state.calls.push(args);
let response; let status = 0;
const route = args.find(a => a.startsWith('repos/') || a.startsWith('https://uploads.github.com/'));
if (route?.includes('/actions/runs/')) response = {artifacts:state.artifacts};
else if (route?.endsWith('/generate-notes')) response = 'generated notes';
else if (route === 'repos/test/repo/releases' && args.includes('POST')) {
  if (state.release) status = 1;
  else { state.release = {id:123, tag_name:'v9.8.7'}; response = state.release; }
} else if (route?.includes('/releases/tags/')) {
  if (!state.release) status = 1; else response = state.release;
} else if (route?.startsWith('https://uploads.github.com/')) {
  const id = Number(route.split('/releases/')[1].split('/')[0]);
  const name = new URL(route).searchParams.get('name');
  if (state.release?.id !== id || state.failUpload === name) status = 1;
  else {
    const file = args[args.indexOf('--input') + 1];
    response = {id:state.assets.length+1,name,state:'uploaded',digest:'sha256:'+crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
    state.assets.push(response);
  }
} else if (route?.includes('/releases/123/assets')) response = state.assets;
else status = 1;
fs.writeFileSync(process.env.STATE_FILE, JSON.stringify(state));
if (response !== undefined) process.stdout.write(typeof response === 'string' ? response : JSON.stringify(response));
process.exit(status);
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(root, "bin/bun"),
    "#!/bin/sh\ncp dist/hyperframes-lambda-handler.zip pinned.zip\n",
    { mode: 0o755 },
  );
  // Registry responses and package bytes are local fixtures; curl never accesses the network.
  writeFileSync(
    join(root, "bin/curl"),
    `#!${process.execPath}
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2); const root = process.env.RUNNER_TEMP;
if (process.env.NPM_STATUS === 'network-error') process.exit(7);
const out = args[args.indexOf('-o') + 1];
if (args.includes('-w')) {
  fs.copyFileSync(path.join(root, 'npm-meta.json'), out);
  process.stdout.write(process.env.NPM_STATUS || '404');
} else fs.copyFileSync(path.join(root, 'npm-package.tgz'), out);
`,
    { mode: 0o755 },
  );
  const published = (pins = {}) => {
    const dir = join(root, "npm-fixture/package/prebuilt");
    mkdirSync(dir, { recursive: true });
    for (const [manifest, asset] of [
      ["handler-zip.json", names[0]],
      ["video-image.json", names[2]],
    ])
      writeFileSync(
        join(dir, manifest),
        JSON.stringify({ sha256: pins[manifest] ?? hash(`built ${asset}`) }),
      );
    execFileSync("tar", [
      "-czf",
      join(root, "npm-package.tgz"),
      "-C",
      join(root, "npm-fixture"),
      "package",
    ]);
    const integrity =
      "sha512-" +
      createHash("sha512")
        .update(readFileSync(join(root, "npm-package.tgz")))
        .digest("base64");
    writeFileSync(
      join(root, "npm-meta.json"),
      JSON.stringify({ dist: { tarball: "https://fixture.invalid/package.tgz", integrity } }),
    );
  };
  published();
  const state = () => JSON.parse(readFileSync(statePath, "utf8"));
  const update = (changes) => writeFileSync(statePath, JSON.stringify({ ...state(), ...changes }));
  const receiptPath = join(root, "release-receipt/receipt.json");
  const receipt = () => JSON.parse(readFileSync(receiptPath, "utf8"));
  const run = (name, env = {}, job = "publish") => {
    const command = step(name, job);
    assert.ok(command, `Missing workflow step: ${name}`);
    return spawnSync(
      "bash",
      [
        "-e",
        ...(workflow.defaults?.run?.shell === "bash" ? ["-o", "pipefail"] : []),
        "-c",
        command.run,
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 5000,
        env: {
          PATH: `${join(root, "bin")}:${process.env.PATH}`,
          STATE_FILE: statePath,
          RUNNER_TEMP: root,
          GITHUB_OUTPUT: join(root, "outputs"),
          REPO: "test/repo",
          VERSION: "9.8.7",
          RUN_ID: "55",
          RUN_NUMBER: "55",
          EXPECTED_RELEASE_SHA: "a".repeat(40),
          PRERELEASE: "false",
          RELEASE_ID: "123",
          ...env,
        },
      },
    );
  };
  return { root, run, state, update, receipt, receiptPath, published };
}
const succeeds = (result) => assert.equal(result.status, 0, result.stdout + result.stderr);
const fails = (result) => assert.notEqual(result.status, 0, result.stdout + result.stderr);

test("a first publish creates a durable receipt before uploads; same-run retry preserves bytes", (t) => {
  const f = fixture(t);
  succeeds(f.run("Create GitHub Release"));
  assert.equal(f.receipt().release_id, 123);
  assert.equal(f.receipt().run, "55");
  assert.equal(f.receipt().assets[names[0]], hash(`built ${names[0]}`));
  succeeds(f.run("Attach Lambda assets to release"));
  succeeds(f.run("Verify Lambda release before npm publication"));
  succeeds(f.run("Create GitHub Release"));
  succeeds(f.run("Attach Lambda assets to release"));
  assert.equal(f.state().assets.length, 4);
  assert.equal(
    f.state().calls.filter((args) => args.includes("repos/test/repo/releases")).length,
    1,
  );
});

test("an existing foreign release is rejected, including a bot-authored creation race", (t) => {
  const f = fixture(t);
  f.update({ release: { id: 999, author: { login: "github-actions[bot]" } } });
  fails(f.run("Create GitHub Release"));
  assert.equal(f.state().assets.length, 0);
});

test("receipt scope, release identity and original digests fail closed", (t) => {
  const f = fixture(t);
  succeeds(f.run("Create GitHub Release"));
  const original = f.receipt();
  for (const changed of [
    { run: "other" },
    { repo: "other/repo" },
    { sha: "b".repeat(40) },
    { tag: "v0.0.0" },
    { release_id: null },
    { release_id: 1.5 },
    { release_id: 999 },
    { assets: {} },
  ]) {
    writeFileSync(f.receiptPath, JSON.stringify({ ...original, ...changed }));
    fails(f.run("Create GitHub Release"));
  }
  writeFileSync(f.receiptPath, JSON.stringify(original));
  f.update({ release: { id: 999 } });
  fails(f.run("Create GitHub Release"));
  f.update({ release: { id: 123 } });
  writeFileSync(join(f.root, "release-bundle/assets", names[0]), "replacement bundle");
  fails(f.run("Create GitHub Release"));
});

test("partial pair upload is recoverable from the exact original bundle", (t) => {
  const f = fixture(t);
  succeeds(f.run("Create GitHub Release"));
  f.update({ failUpload: names[1] });
  fails(f.run("Attach Lambda assets to release"));
  assert.equal(f.state().assets.length, 1);
  f.update({ failUpload: null });
  succeeds(f.run("Create GitHub Release"));
  succeeds(f.run("Attach Lambda assets to release"));
  succeeds(f.run("Verify Lambda release before npm publication"));
  assert.equal(f.state().assets.length, 4);
});

test("missing, altered or ambiguous release assets never pass publication checks", (t) => {
  const f = fixture(t);
  succeeds(f.run("Create GitHub Release"));
  succeeds(f.run("Attach Lambda assets to release"));
  const original = f.state().assets;
  for (const assets of [
    original.slice(1),
    [...original, original[0]],
    original.map((a, i) => (i ? a : { ...a, digest: undefined })),
    original.map((a, i) => (i ? a : { ...a, digest: "sha256:" + "0".repeat(64) })),
  ]) {
    f.update({ assets });
    fails(f.run("Verify Lambda release before npm publication"));
  }
  f.update({ assets: original, release: { id: 999 } });
  fails(f.run("Verify Lambda release before npm publication"));
});

test("a substituted asset is rejected on attachment retry instead of being trusted or clobbered", (t) => {
  const f = fixture(t);
  succeeds(f.run("Create GitHub Release"));
  f.update({
    assets: [{ id: 42, name: names[0], state: "uploaded", digest: "sha256:" + hash("attacker") }],
  });
  fails(f.run("Attach Lambda assets to release"));
  assert.equal(f.state().assets.length, 1);
});

test("artifact lookup is run-scoped and refuses expired or ambiguous receipts and bundles", (t) => {
  const f = fixture(t);
  for (const [name, job, artifactName] of [
    ["Find previous release bundle", "pack", "release-bundle"],
    ["Find previous release receipt", "publish", "lambda-release-receipt"],
  ]) {
    for (const artifacts of [[], [{ id: 7, name: artifactName, expired: false }]]) {
      f.update({ artifacts });
      succeeds(f.run(name, {}, job));
    }
    for (const artifacts of [
      [{ id: 7, name: artifactName, expired: true }],
      [
        { id: 7, name: artifactName, expired: false },
        { id: 8, name: artifactName, expired: false },
      ],
    ]) {
      f.update({ artifacts });
      fails(f.run(name, {}, job));
    }
  }
  assert.ok(
    f.state().calls.every((args) => args.some((arg) => arg.includes("/actions/runs/55/artifacts"))),
  );
});

test("fresh pack pins only the independent build hash and rejects mismatches", (t) => {
  const f = fixture(t);
  for (const expected of ["", "0".repeat(64)])
    fails(f.run("Pin Lambda handler zip", { EXPECTED_SHA256: expected }, "pack"));
  succeeds(f.run("Pin Lambda handler zip", { EXPECTED_SHA256: hash("built zip") }, "pack"));
  assert.equal(readFileSync(join(f.root, "pinned.zip"), "utf8"), "built zip");
  assert.equal(f.state().calls.length, 0);
});

test("receipt and bundle persistence precede side effects and do not overwrite provenance", () => {
  const pack = workflow.jobs.pack;
  const upload = pack.steps.find((s) => s.id === "bundle");
  assert.equal(upload.with.overwrite, false);
  const resolve = pack.steps.findIndex((s) => s.name === "Resolve version");
  for (const s of pack.steps.slice(resolve))
    assert.equal(s.if, "steps.previous_bundle.outputs.artifact == ''");
  const publish = workflow.jobs.publish.steps;
  assert.ok(
    publish.findIndex((s) => s.name === "Save release receipt") <
      publish.findIndex((s) => s.name === "Attach Lambda assets to release"),
  );
  assert.equal(step("Save release receipt").with.overwrite, false);
  assert.ok(
    publish.findIndex((s) => s.name === "Verify Lambda release before npm publication") <
      publish.findIndex((s) => s.name === "Publish packages"),
  );
  const download = publish.find(
    (s) =>
      s.uses?.startsWith("actions/download-artifact@") &&
      s.with.path === "${{ runner.temp }}/release-bundle",
  );
  assert.equal(download.with["artifact-ids"], "${{ needs.pack.outputs.bundle_id }}");
  assert.equal(workflow.jobs.publish.concurrency["cancel-in-progress"], false);
});

// GitHub's implicit bash shell does not enable pipefail; explicit shell: bash does.
test("an incomplete bundle fails before creating a release or receipt", (t) => {
  const f = fixture(t);
  rmSync(join(f.root, "release-bundle/assets", names[0]));
  fails(f.run("Create GitHub Release"));
  assert.equal(f.state().release, null);
});

test("published npm pins accept only the original bundle and an integrity-verified package", (t) => {
  const f = fixture(t);
  succeeds(f.run("Check published Lambda pins"));
  succeeds(f.run("Check published Lambda pins", { NPM_STATUS: "200" }));
  for (const manifest of ["handler-zip.json", "video-image.json"]) {
    f.published({ [manifest]: hash("different published bytes") });
    fails(f.run("Check published Lambda pins", { NPM_STATUS: "200" }));
  }
  f.published();
  writeFileSync(join(f.root, "npm-package.tgz"), "corrupt package");
  fails(f.run("Check published Lambda pins", { NPM_STATUS: "200" }));
  assert.equal(f.state().calls.length, 0);
});

test("npm registry uncertainty fails before release mutation", (t) => {
  const f = fixture(t);
  for (const status of ["500", "403", "network-error"])
    fails(f.run("Check published Lambda pins", { NPM_STATUS: status }));
  const steps = workflow.jobs.publish.steps;
  const check = steps.findIndex((s) => s.name === "Check published Lambda pins");
  assert.ok(check >= 0 && check < steps.findIndex((s) => s.name === "Create GitHub Release"));
  assert.equal(f.state().calls.length, 0);
});
