import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  assertImmutableRelease,
  collectEffectiveApprovals,
  createGitHubClient,
  evaluateRequiredChecks,
  extractEffectiveRules,
  parseGuardTimeoutMs,
  runStableReleaseGuard,
} from "./stable-release-guard.mjs";

const headSha = "1".repeat(40);
const mergeSha = "2".repeat(40);
const capabilityArgs = ["main", 42, mergeSha, 1_000];

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
    verifyPolicyReadCapabilities: async () => undefined,
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
  it("checks policy-read capability before immutable policy evaluation", async () => {
    const order = [];
    await runStableReleaseGuard({
      event: releaseEvent(),
      expectedSha: mergeSha,
      githubSha: mergeSha,
      checkoutSha: mergeSha,
      version: "1.2.3",
      currentRunId: "777",
      client: fakeClient([[check("Build"), check("Test")]], {
        verifyPolicyReadCapabilities: async () => order.push("capability"),
        getPull: async () => {
          order.push("pull");
          return pull();
        },
        getRuleSuite: async () => {
          order.push("rule-suite");
          return { afterSha: mergeSha, ref: "refs/heads/main", result: "pass" };
        },
      }),
      now: () => 0,
      sleep: async () => undefined,
      timeoutMs: 100,
      initialBackoffMs: 10,
      maxBackoffMs: 20,
      log: () => undefined,
    });
    assert.deepEqual(order.slice(0, 3), ["capability", "pull", "rule-suite"]);
  });

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

describe("stable release guard timeout configuration", () => {
  it("uses a safe 25-minute default and accepts a bounded minute override", () => {
    assert.equal(parseGuardTimeoutMs(undefined), 25 * 60 * 1_000);
    assert.equal(parseGuardTimeoutMs("20"), 20 * 60 * 1_000);
    assert.equal(parseGuardTimeoutMs("40"), 40 * 60 * 1_000);
  });

  it("rejects malformed, fractional, lower, and upper out-of-bound values", () => {
    for (const value of ["", "abc", "20.5", "9", "41"]) {
      assert.throws(() => parseGuardTimeoutMs(value), /10.*40.*minutes/i);
    }
  });
});

describe("rule-suite recovery lookback", () => {
  function clientForSuites(suites, requests) {
    return createGitHubClient({
      repository: "heygen-com/hyperframes",
      token: "test-token",
      fetchImpl: async (url) => {
        requests.push(String(url));
        return new Response(JSON.stringify(suites), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
  }

  it("finds an exact passing merge suite older than the default day within the month", async () => {
    const requests = [];
    const client = clientForSuites(
      [
        {
          id: 1,
          after_sha: mergeSha,
          ref: "refs/heads/main",
          result: "pass",
          pushed_at: "2026-08-16T00:00:00Z",
        },
      ],
      requests,
    );
    assert.deepEqual(await client.getRuleSuite(mergeSha, 1_000), {
      afterSha: mergeSha,
      ref: "refs/heads/main",
      result: "pass",
    });
    assert.match(requests[0], /time_period=month/);
  });

  it("fails closed when the month response is absent or ambiguous", async () => {
    for (const suites of [
      [],
      [
        { after_sha: mergeSha, ref: "refs/heads/main", result: "pass" },
        { after_sha: mergeSha, ref: "refs/heads/main", result: "pass" },
      ],
    ]) {
      await assert.rejects(
        clientForSuites(suites, []).getRuleSuite(mergeSha, 1_000),
        /Expected one rule suite/,
      );
    }
  });
});

describe("policy-read credential boundary", () => {
  it("fails closed on a missing or blank dedicated credential before API work", () => {
    for (const token of [undefined, "   "]) {
      const env = {
        ...process.env,
        GITHUB_REPOSITORY: "heygen-com/hyperframes",
      };
      delete env.GH_TOKEN;
      if (token === undefined) delete env.RELEASE_GUARD_TOKEN;
      else env.RELEASE_GUARD_TOKEN = token;
      const result = spawnSync(process.execPath, ["scripts/stable-release-guard.mjs"], {
        cwd: new URL("..", import.meta.url),
        env,
        encoding: "utf8",
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Missing RELEASE_GUARD_TOKEN/);
      assert.doesNotMatch(result.stderr, /Authorization:|Bearer /i);
    }
  });

  it("classifies capability failures without exposing bodies, credentials, or request IDs", async () => {
    const cases = [
      [401, {}, "authentication failure"],
      [403, {}, "authorization or scope failure"],
      [404, {}, "endpoint unavailable"],
      [429, {}, "rate limit"],
      [403, { "x-ratelimit-remaining": "0" }, "rate limit"],
    ];
    for (const [status, headers, expected] of cases) {
      const client = createGitHubClient({
        repository: "heygen-com/hyperframes",
        token: "never-print-this-token",
        fetchImpl: async () =>
          new Response('{"secret":"never-print-this-body"}', {
            status,
            headers: { ...headers, "x-github-request-id": "never-print-this-request-id" },
          }),
      });
      await assert.rejects(client.verifyPolicyReadCapabilities(...capabilityArgs), (error) => {
        assert.match(error.message, new RegExp(expected, "i"));
        assert.match(error.message, /request-id present/i);
        assert.doesNotMatch(error.message, /never-print-this/);
        return true;
      });
    }
  });

  it("rejects malformed capability responses and accepts all read-only endpoints", async () => {
    const malformed = createGitHubClient({
      repository: "heygen-com/hyperframes",
      token: "never-print-this-token",
      fetchImpl: async () => new Response("never-print-this-body", { status: 200 }),
    });
    await assert.rejects(malformed.verifyPolicyReadCapabilities(...capabilityArgs), (error) => {
      assert.match(error.message, /effective branch rules.*malformed/i);
      assert.doesNotMatch(error.message, /never-print-this/);
      return true;
    });

    let requestCount = 0;
    const malformedSuites = createGitHubClient({
      repository: "heygen-com/hyperframes",
      token: "never-print-this-token",
      fetchImpl: async () =>
        new Response(requestCount++ === 0 ? "[]" : "never-print-this-body", { status: 200 }),
    });
    await assert.rejects(
      malformedSuites.verifyPolicyReadCapabilities(...capabilityArgs),
      (error) => {
        assert.match(error.message, /rule suites.*malformed/i);
        assert.doesNotMatch(error.message, /never-print-this/);
        return true;
      },
    );

    const endpoints = [];
    const capable = createGitHubClient({
      repository: "heygen-com/hyperframes",
      token: "never-print-this-token",
      fetchImpl: async (url) => {
        endpoints.push(String(url));
        const body = String(url).includes("/check-runs")
          ? '{"check_runs":[]}'
          : String(url).includes(`/commits/${mergeSha}/status`)
            ? '{"state":"success","statuses":[]}'
            : "[]";
        return new Response(body, { status: 200 });
      },
    });
    await assert.doesNotReject(() => capable.verifyPolicyReadCapabilities(...capabilityArgs));
    assert.equal(endpoints.length, 5);
    assert.match(endpoints[0], /\/rules\/branches\/main/);
    assert.match(endpoints[1], /\/rulesets\/rule-suites/);
    assert.match(endpoints[2], /\/pulls\/42\/reviews/);
    assert.match(endpoints[3], new RegExp(`/commits/${mergeSha}/check-runs`));
    assert.match(endpoints[4], new RegExp(`/commits/${mergeSha}/status`));
  });

  it("sanitizes a denied capability at each authoritative read endpoint", async () => {
    const endpointCases = [
      ["effective branch rules", "/rules/branches/main"],
      ["rule suites", "/rulesets/rule-suites"],
      ["pull request reviews", "/pulls/42/reviews"],
      ["check runs", `/commits/${mergeSha}/check-runs`],
      ["commit statuses", `/commits/${mergeSha}/status`],
    ];
    for (const [label, target] of endpointCases) {
      const client = createGitHubClient({
        repository: "heygen-com/hyperframes",
        token: "never-print-this-token",
        fetchImpl: async (url) => {
          const value = String(url);
          if (value.includes(target)) {
            return new Response("never-print-this-body", {
              status: 403,
              headers: { "x-github-request-id": "never-print-this-request-id" },
            });
          }
          const body = value.includes("/check-runs")
            ? '{"check_runs":[]}'
            : value.includes(`/commits/${mergeSha}/status`)
              ? '{"state":"success","statuses":[]}'
              : "[]";
          return new Response(body, { status: 200 });
        },
      });
      await assert.rejects(client.verifyPolicyReadCapabilities(...capabilityArgs), (error) => {
        assert.match(error.message, new RegExp(label, "i"));
        assert.match(error.message, /authorization or scope failure/i);
        assert.doesNotMatch(error.message, /never-print-this/);
        return true;
      });
    }
  });
});
