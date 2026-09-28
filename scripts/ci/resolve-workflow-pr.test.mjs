import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchedPullRequest } from "./resolve-workflow-pr.mjs";

const pr = {
  state: "open",
  number: 7,
  head: { repo: { full_name: "owner/repo" }, ref: "bot/catalog-publish", sha: "a".repeat(40) },
};
const resolve = (pulls, sha = pr.head.sha) =>
  dispatchedPullRequest(pulls, "owner/repo", pr.head.ref, sha);

test("uses the PR for the dispatched repository, branch and exact head", () => {
  assert.equal(
    resolve([{ ...pr, head: { ...pr.head, repo: { full_name: "fork/repo" } } }, pr]),
    pr,
  );
});
test("refuses a dispatch without an open PR", () => {
  assert.throws(() => resolve([{ ...pr, state: "closed" }]), /exactly one/);
});
test("refuses ambiguous PRs", () => {
  assert.throws(() => resolve([pr, { ...pr, number: 8 }]), /exactly one/);
});
test("refuses a PR which advanced after dispatch", () => {
  assert.throws(() => resolve([pr], "b".repeat(40)), /head changed/);
});
