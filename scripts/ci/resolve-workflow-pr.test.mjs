import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchedPullRequest, resolvedPullRequest } from "./resolve-workflow-pr.mjs";

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

// fails without the fix: a rerun of a PR's first check run replayed the body the PR opened with, so a body fixed
// since (Before/After captures added) still failed the captures check on every rerun.
test("a PR event takes the PR's current body, and keeps the head the run is for", () => {
  const opened = { ...pr, body: "as opened" };
  const asked = [];
  const api = (path) => {
    asked.push(path);
    return { ...pr, body: "as edited", head: { ...pr.head, sha: "b".repeat(40) } };
  };
  const event = { pull_request: opened };
  const env = { GITHUB_EVENT_NAME: "pull_request", GITHUB_REPOSITORY: "owner/repo" };
  const resolved = resolvedPullRequest(event, env, api);
  assert.deepEqual(asked, ["repos/owner/repo/pulls/7"]);
  assert.equal(resolved.body, "as edited");
  assert.equal(resolved.head.sha, pr.head.sha);
});
test("a dispatch finds its PR by branch and exact head", () => {
  const env = {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_REF_NAME: pr.head.ref,
    GITHUB_SHA: pr.head.sha,
  };
  const api = (path) => {
    assert.match(path, /^repos\/owner\/repo\/pulls\?state=open&head=owner%3Abot%2Fcatalog-publish/);
    return [pr];
  };
  assert.equal(resolvedPullRequest({}, env, api), pr);
});
test("refuses an event without a PR", () => {
  assert.throws(
    () => resolvedPullRequest({}, { GITHUB_EVENT_NAME: "push" }, () => null),
    /open pull request/,
  );
});
