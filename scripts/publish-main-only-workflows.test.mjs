import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const workflowsDir = join(import.meta.dirname, "..", ".github", "workflows");
const workflows = readdirSync(workflowsDir)
  .filter((file) => /\.ya?ml$/.test(file))
  .map((file) => {
    const source = readFileSync(join(workflowsDir, file), "utf8");
    return { file, source, doc: parse(source) };
  });

const PUBLISH_SCOPES = ["contents", "id-token", "packages", "pages", "deployments", "attestations"];
const MAIN_GUARD = "github.ref == 'refs/heads/main'";
const normalize = (expression) =>
  String(expression ?? "")
    .replace(/\s+/g, " ")
    .trim();
const usesPublishSecret = (value) =>
  [...JSON.stringify(value ?? {}).matchAll(/secrets\.(\w+)/g)].some(
    ([, name]) => name !== "GITHUB_TOKEN",
  );

function holdsPublishCredential(doc, job) {
  const permissions = job.permissions ?? doc.permissions ?? {};
  const writes =
    permissions === "write-all" || PUBLISH_SCOPES.some((scope) => permissions[scope] === "write");
  return writes || usesPublishSecret(job) || usesPublishSecret(doc.env);
}

const publishingJobs = workflows.flatMap(({ file, doc }) =>
  Object.entries(doc.jobs ?? {})
    .filter(([, job]) => holdsPublishCredential(doc, job))
    .map(([name, job]) => ({ id: `${file} ${name}`, file, doc, job })),
);

function triggers(doc) {
  if (typeof doc.on === "string") return { [doc.on]: null };
  if (Array.isArray(doc.on)) return Object.fromEntries(doc.on.map((event) => [event, null]));
  return doc.on ?? {};
}
const runsOnChosenRef = (doc) =>
  ["workflow_dispatch", "repository_dispatch", "workflow_call"].some((event) =>
    Object.hasOwn(triggers(doc), event),
  );

test("the publish detector finds every known publishing job", () => {
  const ids = publishingJobs.map(({ id }) => id);
  for (const id of [
    "catalog-publish.yml publish",
    "publish-mcp-registry.yml publish",
    "publish.yml publish",
    "sync-skills-to-clawhub.yml sync",
  ]) {
    assert.ok(ids.includes(id), `${id} is no longer detected as publishing`);
  }
});

function targetsBranches(push) {
  if (["branches", "branches-ignore"].some((filter) => Object.hasOwn(push, filter))) return true;
  // A tags-only push filter disables branch pushes; an absent filter does not.
  return !["tags", "tags-ignore"].some((filter) => Object.hasOwn(push, filter));
}

function branchPushViolations({ id, doc }) {
  const events = triggers(doc);
  if (!Object.hasOwn(events, "push")) return [];
  const push = events.push ?? {};
  if (!targetsBranches(push)) return [];
  const branches = push.branches;
  if (branches?.length === 1 && branches[0] === "main") return [];
  return [`${id} publishes from a branch push`];
}

function dispatchGuardViolations({ id, doc, job }) {
  if (!runsOnChosenRef(doc)) return [];
  const guard = normalize(job.if);
  if (guard === MAIN_GUARD) return [];
  return [`${id} can be dispatched on any branch; its job needs if: ${MAIN_GUARD}`];
}

const isCheckout = (step) => step.uses?.startsWith("actions/checkout@");
const checksOutMain = (step) => ["main", "${{ github.sha }}"].includes(step.with?.ref);

function checkoutViolations({ id, doc, job }) {
  if (!runsOnChosenRef(doc)) return [];
  return (job.steps ?? [])
    .filter((step) => isCheckout(step) && !checksOutMain(step))
    .map((step) => `${id} checks out ${step.with?.ref ?? "the dispatched ref"}`);
}

test("a publishing job that can be dispatched runs only for main", () => {
  const violations = publishingJobs.flatMap((entry) => [
    ...branchPushViolations(entry),
    ...dispatchGuardViolations(entry),
    ...checkoutViolations(entry),
  ]);
  assert.deepEqual(violations, []);
});

test("the ClawHub token reaches only the pinned CLI login step", () => {
  const { source, doc } = workflows.find(({ file }) => file === "sync-skills-to-clawhub.yml");
  const sync = doc.jobs.sync;
  assert.equal(sync.environment, "clawhub");
  assert.equal(source.match(/secrets\.CLAWHUB_TOKEN/g).length, 1);
  assert.ok(!usesPublishSecret(doc.env));
  assert.ok(!usesPublishSecret(sync.env));
  const holders = sync.steps.filter((step) => usesPublishSecret(step));
  assert.equal(holders.length, 1);
  assert.deepEqual(holders[0].env, { CLAWHUB_TOKEN: "${{ secrets.CLAWHUB_TOKEN }}" });
  assert.match(holders[0].run, /^clawhub login --token "\$CLAWHUB_TOKEN"/);
  const install = sync.steps.find((step) => /npm i -g clawhub@/.test(step.run ?? ""));
  assert.match(install.run, /clawhub@\d+\.\d+\.\d+$/);
  assert.ok(sync.steps.indexOf(install) < sync.steps.indexOf(holders[0]));
});

test("the catalog PR is the app's, its key reaches only the first step, and Actions cannot write PRs", () => {
  const { source, doc } = workflows.find(({ file }) => file === "catalog-publish.yml");
  const job = doc.jobs.publish;
  assert.equal(job.environment, "catalog-publish");
  assert.notEqual((job.permissions ?? doc.permissions)["pull-requests"], "write");
  assert.equal(source.match(/secrets\.CI_SYNC_PRIVATE_KEY/g).length, 1);
  const [mint] = job.steps;
  assert.match(mint.uses, /^actions\/create-github-app-token@[a-f0-9]{40}$/);
  assert.deepEqual(mint.with, {
    "app-id": "${{ secrets.CI_SYNC_APP_ID }}",
    "private-key": "${{ secrets.CI_SYNC_PRIVATE_KEY }}",
    "permission-pull-requests": "write",
  });
  assert.deepEqual(
    job.steps.filter((step) => usesPublishSecret(step)),
    [mint],
  );
  const holders = job.steps.filter((step) =>
    /steps\.pr-token\.outputs\.token/.test(JSON.stringify(step)),
  );
  assert.equal(holders.length, 1);
  assert.equal(holders[0].run, "node scripts/publish-catalog.mjs");
  assert.equal(holders[0].env.CATALOG_PR_TOKEN, "${{ steps.pr-token.outputs.token }}");
});

test("unrestricted branch pushes cannot evade the publishing policy", () => {
  for (const on of [
    "push",
    ["push"],
    { push: null },
    { push: { paths: ["skills/**"] } },
    { push: { "branches-ignore": ["archive"] } },
  ]) {
    assert.equal(
      branchPushViolations({ id: "fixture", doc: { on } }).length,
      1,
      JSON.stringify(on),
    );
  }
  for (const on of [
    { workflow_dispatch: null },
    { push: { branches: ["main"] } },
    { push: { tags: ["v*-*"] } },
  ]) {
    assert.deepEqual(branchPushViolations({ id: "fixture", doc: { on } }), []);
  }
});

test("dispatch arrays and OR suffixes cannot evade the main guard", () => {
  for (const on of [{ workflow_dispatch: null }, ["workflow_dispatch"], "workflow_call"]) {
    for (const guard of [undefined, `${MAIN_GUARD} && false || true`]) {
      assert.equal(
        dispatchGuardViolations({ id: "fixture", doc: { on }, job: { if: guard } }).length,
        1,
      );
    }
    assert.deepEqual(
      dispatchGuardViolations({ id: "fixture", doc: { on }, job: { if: MAIN_GUARD } }),
      [],
    );
  }
});

test("a job that reads a stored secret binds an environment", () => {
  const unbound = workflows.flatMap(({ file, doc }) =>
    Object.entries(doc.jobs ?? {})
      .filter(([, job]) => usesPublishSecret(job) && !job.environment)
      .map(([name]) => `${file} ${name}`),
  );
  assert.deepEqual(unbound, []);
});

test("a job that can request an OIDC token binds an environment", () => {
  const unbound = workflows.flatMap(({ file, doc }) =>
    Object.entries(doc.jobs ?? {})
      .filter(([, job]) => {
        const permissions = job.permissions ?? doc.permissions ?? {};
        return (
          (permissions === "write-all" || permissions["id-token"] === "write") && !job.environment
        );
      })
      .map(([name]) => `${file} ${name}`),
  );
  assert.deepEqual(unbound, []);
});

// The registry's GitHub login grants io.github.<owner>/* to an OIDC token from any job in the owner's repos, so the
// listing lives under heygen.com, whose signing key only the mcp-registry environment holds.
test("the MCP listing publishes as com.heygen with the environment's domain key, minting no OIDC token", () => {
  const server = JSON.parse(readFileSync(join(import.meta.dirname, "..", "server.json"), "utf8"));
  assert.match(server.name, /^com\.heygen\//);
  const { doc } = workflows.find(({ file }) => file === "publish-mcp-registry.yml");
  const job = doc.jobs.publish;
  assert.equal(job.environment, "mcp-registry");
  assert.notEqual((job.permissions ?? doc.permissions ?? {})["id-token"], "write");
  const runs = job.steps.map((step) => step.run ?? "").join("\n");
  assert.doesNotMatch(runs, /github-oidc/);
  assert.match(
    runs,
    /mcp-publisher login dns --domain heygen\.com --private-key "\$MCP_PRIVATE_KEY"/,
  );
  assert.match(JSON.stringify(job), /"MCP_PRIVATE_KEY":"\$\{\{ secrets\.MCP_PRIVATE_KEY \}\}"/);
});
