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

const triggers = (doc) => (typeof doc.on === "string" ? { [doc.on]: null } : (doc.on ?? {}));
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

function branchPushViolations({ id, doc }) {
  const branches = triggers(doc).push?.branches;
  if (!branches || (branches.length === 1 && branches[0] === "main")) return [];
  return [`${id} publishes from a branch push`];
}

function dispatchGuardViolations({ id, doc, job }) {
  if (!runsOnChosenRef(doc)) return [];
  const guard = normalize(job.if);
  if (guard === MAIN_GUARD || guard.startsWith(`${MAIN_GUARD} && `)) return [];
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
