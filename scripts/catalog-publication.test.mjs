import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { catalogChanges, commitBatches } from "./publish-catalog.mjs";
import { GENERATED_CATALOG_PATHS } from "./catalog-generated-paths.mjs";
import { committedCatalogOutputs } from "./check-catalog-source-pr.mjs";

test("catalog source edits reject generated commits while a publication alone is accepted", () => {
  assert.deepEqual(
    committedCatalogOutputs(["registry/components/new/index.html", "docs/docs.json"]),
    ["docs/docs.json"],
  );
  assert.deepEqual(committedCatalogOutputs(["docs/docs.json"]), []);
  assert.deepEqual(committedCatalogOutputs(["registry/components/new/registry-item.json"]), []);
});

test("publication includes changed, new and deleted generated files and excludes source changes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "catalog-publish-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root });
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  git("init", "-q");
  write("registry/registry.json", "old");
  write("docs/public/catalog/blocks/gone.json", "old");
  write("registry/blocks/source/index.html", "source");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  );
  write("registry/registry.json", "new");
  write("registry/blocks/source/index.html", "changed source");
  write("docs/public/catalog/blocks/new.json", Buffer.from([0, 255, 4]));
  rmSync(join(root, "docs/public/catalog/blocks/gone.json"));
  assert.deepEqual(catalogChanges(root, "HEAD"), [
    { path: "docs/public/catalog/blocks/gone.json", kind: "delete" },
    { path: "docs/public/catalog/blocks/new.json", kind: "write", contents: "AP8E" },
    { path: "registry/registry.json", kind: "write", contents: "bmV3" },
  ]);
});

test("signed API batches preserve deletions and limit each request to 100 changes", () => {
  const changes = Array.from({ length: 101 }, (_, index) => ({
    kind: "delete",
    path: `docs/public/catalog/${index}.json`,
  }));
  const batches = commitBatches(changes);
  assert.deepEqual(
    batches.map((batch) => batch.deletions.length),
    [100, 1],
  );
  assert.deepEqual(batches[1], {
    additions: [],
    deletions: [{ path: "docs/public/catalog/100.json" }],
  });
});

test("oversized API files fail before any publication", () => {
  assert.throws(
    () =>
      commitBatches([
        {
          kind: "write",
          path: "docs/public/catalog/large.json",
          contents: "x".repeat(10 * 1024 * 1024),
        },
      ]),
    /exceeds API batch budget/,
  );
});

function publicationFixture(t, changed) {
  const root = mkdtempSync(join(tmpdir(), "catalog-publication-api-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  for (const path of GENERATED_CATALOG_PATHS) {
    const target = path.includes(".") ? path : `${path}/fixture.json`;
    mkdirSync(dirname(join(root, target)), { recursive: true });
    writeFileSync(join(root, target), "published");
  }
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  );
  const base = git("rev-parse", "HEAD");
  if (changed) writeFileSync(join(root, "registry/registry.json"), "new publication");
  const executable = join(root, "gh");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const endpoint = args[1];
const method = args[args.indexOf("--method") + 1];
const body = args.includes("--input") ? JSON.parse(fs.readFileSync(0, "utf8")) : undefined;
fs.appendFileSync(process.env.API_CALLS, JSON.stringify({ endpoint, method, body }) + "\\n");
if (endpoint === "graphql" || method === "DELETE") {
  console.error(endpoint === "graphql" ? "commit rejected" : "cleanup rejected");
  process.exit(1);
}
if (endpoint.endsWith("/ref/heads/main")) console.log(process.env.BASE);
else if (endpoint.includes("/matching-refs/")) console.log("refs/heads/bot/catalog-publish");
else if (endpoint.includes("/ref/heads/bot/catalog-publish")) console.log("a".repeat(40));
else if (endpoint.includes("/commits/")) console.log("b".repeat(40));
else if (endpoint.includes("/pulls?")) console.log("42");
`,
    { mode: 0o755 },
  );
  const calls = join(root, "calls.jsonl");
  const run = () =>
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
import { publish } from ${JSON.stringify(new URL("./publish-catalog.mjs", import.meta.url).href)};
try { publish(process.env.FIXTURE_ROOT); }
catch (error) {
  console.log(JSON.stringify({ message: error.message, causes: error.errors?.map(cause => cause.message) }));
  process.exitCode = 1;
}
`,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          BASE: base,
          API_CALLS: calls,
          FIXTURE_ROOT: root,
          GITHUB_REPOSITORY: "test/catalog",
          GITHUB_RUN_ID: "123",
          GITHUB_RUN_ATTEMPT: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  return {
    root,
    base,
    run,
    calls: () =>
      readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
  };
}

test("reverting unpublished sources closes the obsolete PR and resets its branch to main", (t) => {
  const fixture = publicationFixture(t, false);
  fixture.run();
  assert.deepEqual(
    fixture.calls().filter((call) => call.method !== "GET"),
    [
      { endpoint: "repos/test/catalog/pulls/42", method: "PATCH", body: { state: "closed" } },
      {
        endpoint: "repos/test/catalog/git/refs/heads/bot/catalog-publish",
        method: "PATCH",
        body: { sha: fixture.base, force: true },
      },
    ],
  );
});

test("a failed staging cleanup preserves the publication failure as well", (t) => {
  const fixture = publicationFixture(t, true);
  assert.throws(fixture.run, (error) => {
    const result = JSON.parse(error.stdout.trim().split("\n").at(-1));
    assert.equal(result.message, "Publication and staging cleanup failed.");
    assert.equal(result.causes.length, 2);
    assert.match(result.causes[0], /commit rejected/);
    assert.match(result.causes[1], /cleanup rejected/);
    return true;
  });
  assert.equal(fixture.calls().at(-1).method, "DELETE");
  assert.equal(
    fixture.calls().some((call) => call.method === "PATCH"),
    false,
  );
});

test("publication refuses symlinks instead of reading outside the generated artifact", (t) => {
  const fixture = publicationFixture(t, false);
  const artifact = join(fixture.root, "registry/registry.json");
  const unrelated = join(fixture.root, "private.txt");
  writeFileSync(unrelated, "must not be published");
  rmSync(artifact);
  symlinkSync(unrelated, artifact);
  assert.throws(() => catalogChanges(fixture.root, "HEAD"), /ELOOP|symbolic link/);
});
