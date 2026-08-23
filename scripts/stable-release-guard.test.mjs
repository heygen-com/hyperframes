import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertImmutableRelease,
  collectEffectiveApprovals,
  evaluateRequiredChecks,
  extractEffectiveRules,
  runStableReleaseGuard,
} from "./stable-release-guard.mjs";

const headSha = "1".repeat(40);
const mergeSha = "2".repeat(40);

function releaseEvent(overrides = {}) {
  return {
    action: "closed",
    pull_request: {
      number: 42,
      merged: true,
      base: { ref: "main" },
      head: { ref: "release/v1.2.3", sha: headSha },
      merge_commit_sha: mergeSha,
      user: { login: "release-author" },
    },
    ...overrides,
  };
}

function pull(overrides = {}) {
  return {
    number: 42,
    merged: true,
    base: { ref: "main" },
    head: { ref: "release/v1.2.3", sha: headSha },
    merge_commit_sha: mergeSha,
    user: { login: "release-author" },
    ...overrides,
  };
}

function review(overrides = {}) {
  return {
    id: 1,
    user: { login: "reviewer" },
    state: "APPROVED",
    commit_id: headSha,
    submitted_at: "2026-08-23T18:00:00Z",
    ...overrides,
  };
}

const requiredChecks = [
  { context: "Build", integrationId: 15368 },
  { context: "Test", integrationId: 15368 },
];

function check(name, overrides = {}) {
  return {
    id: name === "Build" ? 100 : 200,
    name,
    app: { id: 15368 },
    status: "completed",
    conclusion: "success",
    started_at: "2026-08-23T18:00:00Z",
    completed_at: "2026-08-23T18:01:00Z",
    details_url: "https://github.com/heygen-com/hyperframes/actions/runs/99/job/1",
    ...overrides,
  };
}

describe("immutable stable release identity", () => {
  it("accepts one exact merged release PR identity", () => {
    assert.doesNotThrow(() =>
      assertImmutableRelease({
        event: releaseEvent(),
        apiPull: pull(),
        expectedSha: mergeSha,
        githubSha: mergeSha,
        checkoutSha: mergeSha,
        version: "1.2.3",
      }),
    );
  });

  it("rejects non-merged, wrong-base, wrong-branch, and any SHA/version mismatch", () => {
    const base = {
      event: releaseEvent(),
      apiPull: pull(),
      expectedSha: mergeSha,
      githubSha: mergeSha,
      checkoutSha: mergeSha,
      version: "1.2.3",
    };
    for (const mutation of [
      { event: releaseEvent({ action: "opened" }) },
      { apiPull: pull({ merged: false }) },
      { apiPull: pull({ base: { ref: "next" } }) },
      { apiPull: pull({ head: { ref: "feature/not-release", sha: headSha } }) },
      { expectedSha: "3".repeat(40) },
      { githubSha: "3".repeat(40) },
      { checkoutSha: "3".repeat(40) },
      { version: "1.2.4" },
    ]) {
      assert.throws(
        () => assertImmutableRelease({ ...base, ...mutation }),
        /release|mismatch|merged|main/i,
      );
    }
  });
});

describe("effective final-head approvals", () => {
  it("requires the ruleset count of effective non-author final-head approvals", () => {
    assert.deepEqual(
      collectEffectiveApprovals({
        reviews: [review(), review({ id: 2, user: { login: "second" } })],
        authorLogin: "release-author",
        headSha,
        requiredCount: 2,
      }),
      ["reviewer", "second"],
    );
  });

  it("fails zero, author-only, old-head, dismissed, and later change-requested reviews", () => {
    for (const reviews of [
      [],
      [review({ user: { login: "release-author" } })],
      [review({ commit_id: "0".repeat(40) })],
      [review(), review({ id: 2, state: "DISMISSED", submitted_at: "2026-08-23T18:02:00Z" })],
      [
        review(),
        review({ id: 2, state: "CHANGES_REQUESTED", submitted_at: "2026-08-23T18:02:00Z" }),
      ],
    ]) {
      assert.throws(
        () =>
          collectEffectiveApprovals({
            reviews,
            authorLogin: "release-author",
            headSha,
            requiredCount: 1,
          }),
        /approval/i,
      );
    }
  });

  it("fails closed on malformed decisive review records", () => {
    for (const malformed of [
      review({ id: "not-a-number" }),
      review({ submitted_at: "not-a-date" }),
      review({ user: {} }),
      review({ commit_id: null }),
      review({ state: "UNKNOWN" }),
    ]) {
      assert.throws(
        () =>
          collectEffectiveApprovals({
            reviews: [malformed, review({ id: 99, user: { login: "valid" } })],
            authorLogin: "release-author",
            headSha,
            requiredCount: 1,
          }),
        /malformed review/i,
      );
    }
  });
});

// fallow-ignore-next-line unit-size
describe("latest required checks", () => {
  it("accepts success, neutral, and skipped while ignoring irrelevant checks", () => {
    const outcome = evaluateRequiredChecks({
      requiredChecks,
      checkRuns: [
        check("Build"),
        check("Test", { conclusion: "neutral" }),
        check("Docs", { conclusion: "failure" }),
      ],
      currentRunId: "777",
    });
    assert.equal(outcome.kind, "passing");
  });

  it("uses only the newest attempt for duplicate contexts", () => {
    for (const [newestStatus, newestConclusion, expectedKind] of [
      ["in_progress", null, "pending"],
      ["completed", "failure", "terminal-failure"],
      ["completed", "success", "passing"],
    ]) {
      const outcome = evaluateRequiredChecks({
        requiredChecks: [requiredChecks[0]],
        checkRuns: [
          check("Build", { id: 1, started_at: "2026-08-23T18:00:00Z" }),
          check("Build", {
            id: 2,
            status: newestStatus,
            conclusion: newestConclusion,
            started_at: "2026-08-23T18:02:00Z",
            completed_at: newestStatus === "completed" ? "2026-08-23T18:03:00Z" : null,
          }),
        ],
        currentRunId: "777",
      });
      assert.equal(outcome.kind, expectedKind);
    }
    assert.equal(
      evaluateRequiredChecks({
        requiredChecks: [requiredChecks[0]],
        checkRuns: [
          check("Build", { id: 999, started_at: "2026-08-23T17:00:00Z" }),
          check("Build", { id: 2, started_at: "2026-08-23T18:00:00Z" }),
        ],
        currentRunId: "777",
      }).kind,
      "passing",
    );
  });

  it("fails terminal conclusions and identifies missing, pending, and self-referential checks", () => {
    for (const conclusion of [
      "failure",
      "cancelled",
      "timed_out",
      "action_required",
      "stale",
      "startup_failure",
    ]) {
      assert.equal(
        evaluateRequiredChecks({
          requiredChecks: [requiredChecks[0]],
          checkRuns: [check("Build", { conclusion })],
          currentRunId: "777",
        }).kind,
        "terminal-failure",
      );
    }
    assert.equal(
      evaluateRequiredChecks({ requiredChecks, checkRuns: [], currentRunId: "777" }).kind,
      "pending",
    );
    assert.equal(
      evaluateRequiredChecks({
        requiredChecks: [requiredChecks[0]],
        checkRuns: [check("Build", { status: "queued", conclusion: null })],
        currentRunId: "777",
      }).kind,
      "pending",
    );
    assert.equal(
      evaluateRequiredChecks({
        requiredChecks: [requiredChecks[0]],
        checkRuns: [
          check("Build", {
            details_url: "https://github.com/heygen-com/hyperframes/actions/runs/777/job/1",
          }),
        ],
        currentRunId: "777",
      }).kind,
      "self-reference",
    );
  });
});

describe("effective repository rules", () => {
  it("extracts required contexts with integration identity and the approval count", () => {
    assert.deepEqual(
      extractEffectiveRules([
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [
              { context: "Build", integration_id: 15368 },
              { context: "Test", integration_id: 15368 },
            ],
          },
        },
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 2,
            require_last_push_approval: true,
            require_extra_approval_for_unattributed_changes: true,
          },
        },
        { type: "required_signatures" },
      ]),
      {
        requiredApprovals: 2,
        requiredChecks,
        requireLastPushApproval: true,
        requireExtraApprovalForUnattributedChanges: true,
        requireSignedCommits: true,
      },
    );
  });

  it("fails closed for malformed or unsupported gate rules", () => {
    assert.throws(() => extractEffectiveRules([]), /required status checks/i);
    assert.throws(
      () => extractEffectiveRules([{ type: "required_status_checks", parameters: {} }]),
      /malformed/i,
    );
    assert.throws(() => extractEffectiveRules([{ type: "required_deployments" }]), /unsupported/i);
  });
});

function fakeClient(checkResponses, overrides = {}) {
  let index = 0;
  return {
    getPull: async () => pull(),
    getRuleSuite: async () => ({ afterSha: mergeSha, ref: "refs/heads/main", result: "pass" }),
    listReviews: async () => [review()],
    getEffectiveRules: async () => ({ requiredApprovals: 1, requiredChecks }),
    listCheckRuns: async () => checkResponses[Math.min(index++, checkResponses.length - 1)],
    ...overrides,
  };
}

// fallow-ignore-next-line unit-size
describe("stable release polling guard", () => {
  it("passes all-green and pending-then-green cases", async () => {
    for (const responses of [
      [[check("Build"), check("Test")]],
      [
        [check("Build", { status: "queued", conclusion: null }), check("Test")],
        [check("Build"), check("Test")],
      ],
    ]) {
      let now = 0;
      await assert.doesNotReject(() =>
        runStableReleaseGuard({
          event: releaseEvent(),
          expectedSha: mergeSha,
          githubSha: mergeSha,
          checkoutSha: mergeSha,
          version: "1.2.3",
          currentRunId: "777",
          client: fakeClient(responses),
          now: () => now,
          sleep: async (ms) => {
            now += ms;
          },
          timeoutMs: 100,
          initialBackoffMs: 10,
          maxBackoffMs: 20,
          log: () => undefined,
        }),
      );
    }
  });

  it("fails closed for timeout, terminal failure, API error, approval failure, and immutable mismatch", async () => {
    const pending = [check("Build", { status: "queued", conclusion: null }), check("Test")];
    const base = {
      event: releaseEvent(),
      expectedSha: mergeSha,
      githubSha: mergeSha,
      checkoutSha: mergeSha,
      version: "1.2.3",
      currentRunId: "777",
      now: () => nowValue,
      sleep: async (ms) => {
        nowValue += ms;
      },
      timeoutMs: 50,
      initialBackoffMs: 10,
      maxBackoffMs: 20,
      log: () => undefined,
    };
    let nowValue = 0;
    await assert.rejects(
      runStableReleaseGuard({ ...base, client: fakeClient([pending]) }),
      /timed out/i,
    );
    await assert.rejects(
      runStableReleaseGuard({
        ...base,
        client: fakeClient([[check("Build", { conclusion: "failure" }), check("Test")]]),
      }),
      /failed/i,
    );
    await assert.rejects(
      runStableReleaseGuard({
        ...base,
        client: fakeClient([], {
          getEffectiveRules: async () => {
            throw new Error("API down");
          },
        }),
      }),
      /API down/,
    );
    await assert.rejects(
      runStableReleaseGuard({
        ...base,
        client: fakeClient([], { listReviews: async () => [] }),
      }),
      /approval/i,
    );
    await assert.rejects(
      runStableReleaseGuard({
        ...base,
        githubSha: "3".repeat(40),
        client: fakeClient([[check("Build"), check("Test")]]),
      }),
      /mismatch/i,
    );
    await assert.rejects(
      runStableReleaseGuard({
        ...base,
        client: fakeClient([[check("Build"), check("Test")]], {
          getRuleSuite: async () => ({
            afterSha: mergeSha,
            ref: "refs/heads/main",
            result: "bypass",
          }),
        }),
      }),
      /rule suite.*bypass/i,
    );
  });

  it("clamps every wait and API request to the hard deadline", async () => {
    let nowValue = 0;
    const sleeps = [];
    const requestBudgets = [];
    const client = fakeClient(
      [[check("Build", { status: "queued", conclusion: null }), check("Test")]],
      {
        listCheckRuns: async (_sha, budget) => {
          requestBudgets.push(budget);
          return [check("Build", { status: "queued", conclusion: null }), check("Test")];
        },
      },
    );
    await assert.rejects(
      runStableReleaseGuard({
        event: releaseEvent(),
        expectedSha: mergeSha,
        githubSha: mergeSha,
        checkoutSha: mergeSha,
        version: "1.2.3",
        currentRunId: "777",
        client,
        now: () => nowValue,
        sleep: async (ms) => {
          sleeps.push(ms);
          nowValue += ms;
        },
        timeoutMs: 25,
        initialBackoffMs: 20,
        maxBackoffMs: 30,
        log: () => undefined,
      }),
      /timed out/i,
    );
    assert.deepEqual(sleeps, [20, 5]);
    assert.ok(requestBudgets.every((budget) => budget > 0 && budget <= 25));
  });
});
