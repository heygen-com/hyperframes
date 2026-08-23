#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MIN_TIMEOUT_MINUTES = 15;
const MAX_TIMEOUT_MINUTES = 40;
const DEFAULT_TIMEOUT_MINUTES = 25;
export const DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_MINUTES * 60 * 1_000;
export const INITIAL_BACKOFF_MS = 5_000;
export const MAX_BACKOFF_MS = 30_000;

const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
const TERMINAL_FAILURE_CONCLUSIONS = new Set([
  "action_required",
  "cancelled",
  "failure",
  "stale",
  "startup_failure",
  "timed_out",
  "error",
]);
const DECISIVE_REVIEW_STATES = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);
const REVIEW_STATES = new Set([...DECISIVE_REVIEW_STATES, "COMMENTED"]);
const HTTP_FAILURE_CLASSIFICATIONS = new Map([
  [401, "authentication failure"],
  [403, "authorization or scope failure"],
  [404, "endpoint unavailable"],
  [429, "rate limit"],
]);
const HEADER_FAILURE_CLASSIFICATIONS = new Map([["403:0", "rate limit"]]);
const NON_CHECK_RULES = new Set([
  "creation",
  "update",
  "deletion",
  "required_linear_history",
  "required_signatures",
  "non_fast_forward",
  "commit_message_pattern",
  "commit_author_email_pattern",
  "committer_email_pattern",
  "branch_name_pattern",
  "tag_name_pattern",
]);

function classifyHttpFailure(response) {
  const headerKey = `${response.status}:${response.headers.get("x-ratelimit-remaining")}`;
  return (
    HEADER_FAILURE_CLASSIFICATIONS.get(headerKey) ??
    HTTP_FAILURE_CLASSIFICATIONS.get(response.status) ??
    "HTTP failure"
  );
}

function assertCapabilityArray(value, endpoint) {
  if (!Array.isArray(value)) {
    throw new Error(`GitHub policy-read capability ${endpoint}: malformed response.`);
  }
}

function assertVisibleRuleSuite(suite, sha) {
  const record = Object(suite);
  const visible = [
    record.afterSha === sha,
    record.ref === "refs/heads/main",
    typeof record.result === "string",
    String(record.result).length > 0,
  ].every(Boolean);
  if (!visible) throw new Error(`Rule suite result is not visible for merged main SHA ${sha}.`);
}

function isEligibleMergedMainPull(candidate) {
  const record = Object(candidate);
  return [
    Number.isInteger(record.number),
    typeof record.merged_at === "string",
    String(record.merged_at).length > 0,
    typeof record.merge_commit_sha === "string",
    String(record.merge_commit_sha).length > 0,
  ].every(Boolean);
}

// One parser owns syntax and both policy bounds so configuration cannot bypass either limit.
// fallow-ignore-next-line complexity
export function parseGuardTimeoutMs(value) {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `Stable release guard timeout must be an integer from ${MIN_TIMEOUT_MINUTES} to ${MAX_TIMEOUT_MINUTES} minutes.`,
    );
  }
  const minutes = Number(value);
  if (minutes < MIN_TIMEOUT_MINUTES || minutes > MAX_TIMEOUT_MINUTES) {
    throw new Error(
      `Stable release guard timeout must be an integer from ${MIN_TIMEOUT_MINUTES} to ${MAX_TIMEOUT_MINUTES} minutes.`,
    );
  }
  return minutes * 60 * 1_000;
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing ${label}.`);
  return value;
}

function requiredCredential(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      "Missing RELEASE_GUARD_TOKEN. Provision the documented read-only policy credential before merging.",
    );
  }
  return value.trim();
}

function requiredNumber(value, label) {
  if (!Number.isInteger(value)) throw new Error(`Missing ${label}.`);
  return value;
}

// fallow-ignore-next-line complexity
function pullIdentity(pull, label) {
  if (!pull || typeof pull !== "object") throw new Error(`Missing ${label}.`);
  return {
    number: requiredNumber(pull.number, `${label} number`),
    merged: pull.merged === true,
    baseRef: requiredString(pull.base?.ref, `${label} base ref`),
    headRef: requiredString(pull.head?.ref, `${label} head ref`),
    headSha: requiredString(pull.head?.sha, `${label} head SHA`),
    mergeSha: requiredString(pull.merge_commit_sha, `${label} merge SHA`),
    authorLogin: requiredString(pull.user?.login, `${label} author`),
  };
}

// All identity comparisons stay together so no caller can omit one.
// fallow-ignore-next-line complexity
export function assertImmutableRelease({
  event,
  apiPull,
  expectedSha,
  githubSha,
  checkoutSha,
  version,
}) {
  if (event?.action !== "closed")
    throw new Error("Stable release event must be pull_request closed.");
  const fromEvent = pullIdentity(event.pull_request, "event pull request");
  const fromApi = pullIdentity(apiPull, "API pull request");
  if (!fromEvent.merged || !fromApi.merged) throw new Error("Stable release PR must be merged.");
  if (fromEvent.baseRef !== "main" || fromApi.baseRef !== "main")
    throw new Error("Stable release PR must target main.");
  const expectedBranch = `release/v${version}`;
  if (fromEvent.headRef !== expectedBranch || fromApi.headRef !== expectedBranch) {
    throw new Error(`Stable release branch mismatch: expected ${expectedBranch}.`);
  }
  const identities = [
    ["PR number", fromEvent.number, fromApi.number],
    ["head SHA", fromEvent.headSha, fromApi.headSha],
    ["merge SHA", fromEvent.mergeSha, fromApi.mergeSha],
    ["author", fromEvent.authorLogin, fromApi.authorLogin],
    ["EXPECTED_RELEASE_SHA", fromEvent.mergeSha, expectedSha],
    ["GITHUB_SHA", fromEvent.mergeSha, githubSha],
    ["checked-out HEAD", fromEvent.mergeSha, checkoutSha],
  ];
  for (const [label, expected, actual] of identities) {
    if (expected !== actual)
      throw new Error(`${label} mismatch: expected ${expected}, got ${actual}.`);
  }
  return fromEvent;
}

function reviewOrder(review) {
  return [Date.parse(review.submitted_at), review.id];
}

// Every decisive review field is validated together so malformed records cannot be partially used.
// fallow-ignore-next-line complexity
function validateReview(review) {
  const state = typeof review?.state === "string" ? review.state.toUpperCase() : "";
  if (
    !Number.isInteger(review?.id) ||
    typeof review?.user?.login !== "string" ||
    review.user.login.length === 0 ||
    !REVIEW_STATES.has(state) ||
    typeof review?.submitted_at !== "string" ||
    !Number.isFinite(Date.parse(review.submitted_at)) ||
    typeof review?.commit_id !== "string" ||
    review.commit_id.length === 0
  ) {
    throw new Error(
      `Malformed review record: reviewer=${String(review?.user?.login)} state=${String(review?.state)} head=${String(review?.commit_id)}.`,
    );
  }
  return { ...review, state };
}

// The decisive-review reducer mirrors GitHub's per-reviewer state semantics.
// fallow-ignore-next-line complexity
export function collectEffectiveApprovals({ reviews, authorLogin, headSha, requiredCount }) {
  if (!Array.isArray(reviews)) throw new Error("Review API response is malformed.");
  const latestByReviewer = new Map();
  for (const candidate of reviews) {
    const review = validateReview(candidate);
    const { state } = review;
    const login = review.user.login;
    if (!DECISIVE_REVIEW_STATES.has(state)) continue;
    const existing = latestByReviewer.get(login.toLowerCase());
    const [time, id] = reviewOrder(review);
    const [existingTime, existingId] = existing ? reviewOrder(existing) : [-1, -1];
    if (!existing || time > existingTime || (time === existingTime && id > existingId)) {
      latestByReviewer.set(login.toLowerCase(), review);
    }
  }
  const approvals = [...latestByReviewer.values()]
    .filter(
      (review) =>
        review.state.toUpperCase() === "APPROVED" &&
        review.commit_id === headSha &&
        review.user.login.toLowerCase() !== authorLogin.toLowerCase(),
    )
    .map((review) => review.user.login)
    .sort();
  const minimum = Math.max(1, Number.isInteger(requiredCount) ? requiredCount : 0);
  if (approvals.length < minimum) {
    throw new Error(
      `Final release head requires ${minimum} valid non-author approval(s); found ${approvals.length}.`,
    );
  }
  return approvals;
}

// Unknown effective gates must fail closed rather than disappear during parsing.
// fallow-ignore-next-line complexity
export function extractEffectiveRules(rules) {
  if (!Array.isArray(rules)) throw new Error("Repository rules API response is malformed.");
  const requiredChecks = [];
  let requiredApprovals = 0;
  let requireLastPushApproval = false;
  let requireExtraApprovalForUnattributedChanges = false;
  let requireSignedCommits = false;
  for (const rule of rules) {
    if (rule?.type === "required_status_checks") {
      const checks = rule.parameters?.required_status_checks;
      if (!Array.isArray(checks)) throw new Error("Required status checks rule is malformed.");
      for (const check of checks) {
        if (
          typeof check?.context !== "string" ||
          !Number.isInteger(check.integration_id) ||
          check.integration_id <= 0
        ) {
          throw new Error("Required status check identity is malformed.");
        }
        requiredChecks.push({ context: check.context, integrationId: check.integration_id });
      }
      continue;
    }
    if (rule?.type === "pull_request") {
      const count = rule.parameters?.required_approving_review_count;
      if (!Number.isInteger(count)) throw new Error("Pull request approval rule is malformed.");
      requiredApprovals = Math.max(requiredApprovals, count);
      requireLastPushApproval ||= rule.parameters.require_last_push_approval === true;
      requireExtraApprovalForUnattributedChanges ||=
        rule.parameters.require_extra_approval_for_unattributed_changes === true;
      continue;
    }
    if (rule?.type === "required_signatures") {
      requireSignedCommits = true;
      continue;
    }
    if (!NON_CHECK_RULES.has(rule?.type)) {
      throw new Error(`Unsupported effective repository rule: ${String(rule?.type)}.`);
    }
  }
  if (requiredChecks.length === 0) throw new Error("No required status checks found for main.");
  const unique = new Map(
    requiredChecks.map((check) => [`${check.context}:${check.integrationId}`, check]),
  );
  return {
    requiredApprovals,
    requiredChecks: [...unique.values()],
    requireLastPushApproval,
    requireExtraApprovalForUnattributedChanges,
    requireSignedCommits,
  };
}

// The exact update identity and outcome form one indivisible authoritative gate.
// fallow-ignore-next-line complexity
function assertRuleSuitePass(suite, mergeSha) {
  if (
    suite?.afterSha !== mergeSha ||
    suite?.ref !== "refs/heads/main" ||
    suite?.result !== "pass"
  ) {
    throw new Error(
      `Rule suite for ${mergeSha} must be pass, got after=${String(suite?.afterSha)} ref=${String(suite?.ref)} result=${String(suite?.result)}.`,
    );
  }
}

// fallow-ignore-next-line complexity
function checkOrder(check) {
  return [
    Date.parse(check.started_at ?? "") || 0,
    Date.parse(check.completed_at ?? "") || 0,
    Number(check.id) || 0,
  ];
}

function isNewer(candidate, existing) {
  const left = checkOrder(candidate);
  const right = checkOrder(existing);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

function belongsToRun(check, runId) {
  return Boolean(runId) && String(check.details_url ?? "").includes(`/actions/runs/${runId}/`);
}

// Required-context classification remains one exhaustive outcome reducer.
// fallow-ignore-next-line complexity
export function evaluateRequiredChecks({ requiredChecks, checkRuns, currentRunId }) {
  if (!Array.isArray(checkRuns))
    return { kind: "api-failure", summary: "Check-runs response is malformed." };
  const details = [];
  for (const requirement of requiredChecks) {
    const matching = checkRuns.filter(
      (check) =>
        check?.name === requirement.context && check?.app?.id === requirement.integrationId,
    );
    const latest = matching.reduce(
      (selected, candidate) => (!selected || isNewer(candidate, selected) ? candidate : selected),
      null,
    );
    if (!latest) {
      details.push(`${requirement.context}: missing`);
      continue;
    }
    if (belongsToRun(latest, currentRunId)) {
      return {
        kind: "self-reference",
        summary: `${requirement.context} resolves to current publish run ${currentRunId}.`,
      };
    }
    if (latest.status !== "completed") {
      details.push(`${requirement.context}: ${latest.status}`);
      continue;
    }
    if (PASSING_CONCLUSIONS.has(latest.conclusion)) continue;
    if (TERMINAL_FAILURE_CONCLUSIONS.has(latest.conclusion) || latest.conclusion == null) {
      return {
        kind: "terminal-failure",
        summary: `${requirement.context}: ${String(latest.conclusion)}`,
      };
    }
    return {
      kind: "terminal-failure",
      summary: `${requirement.context}: unsupported conclusion ${latest.conclusion}`,
    };
  }
  return details.length > 0
    ? { kind: "pending", summary: details.join(", ") }
    : { kind: "passing", summary: "All required checks are terminal green." };
}

// fallow-ignore-next-line complexity
export async function runStableReleaseGuard({
  event,
  expectedSha,
  githubSha,
  checkoutSha,
  version,
  currentRunId,
  client,
  now,
  sleep,
  timeoutMs,
  initialBackoffMs,
  maxBackoffMs,
  log,
}) {
  const deadline = now() + timeoutMs;
  const remainingBudget = (phase) => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error(`Timed out during stable release guard (${phase}).`);
    return remaining;
  };
  await client.verifyPolicyReadCapabilities(
    "main",
    requiredNumber(event?.pull_request?.number, "event pull request number"),
    requiredString(event?.pull_request?.merge_commit_sha, "event pull request merge SHA"),
    remainingBudget("policy-read capability"),
  );
  const apiPull = await client.getPull(event.pull_request.number, remainingBudget("pull request"));
  const identity = assertImmutableRelease({
    event,
    apiPull,
    expectedSha,
    githubSha,
    checkoutSha,
    version,
  });
  const ruleSuite = await client.getRuleSuite(identity.mergeSha, remainingBudget("rule suite"));
  assertRuleSuitePass(ruleSuite, identity.mergeSha);
  const rules = await client.getEffectiveRules("main", remainingBudget("effective rules"));
  const reviews = await client.listReviews(identity.number, remainingBudget("reviews"));
  const approvals = collectEffectiveApprovals({
    reviews,
    authorLogin: identity.authorLogin,
    headSha: identity.headSha,
    requiredCount: rules.requiredApprovals,
  });
  log(
    `Stable release identity verified: PR #${identity.number} head=${identity.headSha} merge=${identity.mergeSha}.`,
  );
  log(`Valid final-head approvals: ${approvals.join(", ")}.`);
  // Last-push approval, extra unattributed-change approval, and signed commits are enforced indirectly
  // by requiring the exact main-update rule-suite result to be pass; check contexts and the final-head
  // non-author review count are additionally revalidated explicitly here.
  log(
    `Effective PR rules: last-push=${rules.requireLastPushApproval === true} unattributed=${rules.requireExtraApprovalForUnattributedChanges === true} signatures=${rules.requireSignedCommits === true}; exact update rule suite passed.`,
  );

  let backoff = initialBackoffMs;
  while (true) {
    const checkRuns = await client.listCheckRuns(
      identity.mergeSha,
      remainingBudget("required checks"),
    );
    const outcome = evaluateRequiredChecks({
      requiredChecks: rules.requiredChecks,
      checkRuns,
      currentRunId,
    });
    log(`Required checks: ${outcome.summary}`);
    if (outcome.kind === "passing") return;
    if (outcome.kind !== "pending")
      throw new Error(`Stable release checks failed: ${outcome.summary}`);
    const remaining = deadline - now();
    if (remaining <= 0)
      throw new Error(
        `Timed out waiting for required checks on ${identity.mergeSha}: ${outcome.summary}`,
      );
    await sleep(Math.min(backoff, remaining));
    backoff = Math.min(maxBackoffMs, backoff * 2);
  }
}

export async function runCredentialHealth({ client, now, timeoutMs, log }) {
  const deadline = now() + timeoutMs;
  const remainingBudget = (phase) => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error(`Timed out during credential health (${phase}).`);
    return remaining;
  };
  const pull = await client.findRecentMergedMainPull(
    remainingBudget("merged main pull request discovery"),
  );
  if (!pull) throw new Error("No eligible merged main pull request found for credential health.");
  const rules = await client.getEffectiveRules("main", remainingBudget("effective rules"));
  const suite = await client.getRuleSuite(pull.mergeSha, remainingBudget("rule suite"));
  assertVisibleRuleSuite(suite, pull.mergeSha);
  const reviews = await client.listReviews(pull.number, remainingBudget("reviews"));
  const checkRuns = await client.listCheckRuns(pull.mergeSha, remainingBudget("check runs"));
  log(
    `Release guard credential health verified for PR #${pull.number} merge=${pull.mergeSha}: ` +
      `${rules.requiredChecks.length} required check contract(s), rule-suite result visible, ` +
      `${reviews.length} review record(s), ${checkRuns.length} check run(s).`,
  );
}

export function createGitHubClient({ repository, token, fetchImpl = fetch }) {
  const requestIdClassification = (response) =>
    response.headers.get("x-github-request-id") ? "present" : "absent";
  const capabilityFailure = (endpoint, classification, response) =>
    new Error(
      `GitHub policy-read capability ${endpoint}: ${classification} (status ${response.status}, request-id ${requestIdClassification(response)}).`,
    );
  const request = async (path, requestBudgetMs, endpoint) => {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(Math.max(1, requestBudgetMs)),
    });
    if (!response.ok) {
      throw capabilityFailure(endpoint, classifyHttpFailure(response), response);
    }
    try {
      return await response.json();
    } catch {
      throw capabilityFailure(endpoint, "malformed response", response);
    }
  };
  // fallow-ignore-next-line complexity
  const paginate = async (path, itemKey, requestBudgetMs, endpoint) => {
    const items = [];
    const deadline = Date.now() + requestBudgetMs;
    for (let page = 1; ; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`GitHub API pagination timed out for ${path}.`);
      const response = await request(
        `${path}${separator}per_page=100&page=${page}`,
        remaining,
        endpoint,
      );
      const pageItems = itemKey ? response?.[itemKey] : response;
      if (!Array.isArray(pageItems))
        throw new Error(`GitHub policy-read capability ${endpoint}: malformed response.`);
      items.push(...pageItems);
      if (pageItems.length < 100) return items;
    }
  };
  return {
    verifyPolicyReadCapabilities: async (branch, pullNumber, sha, requestBudgetMs) => {
      const deadline = Date.now() + requestBudgetMs;
      const remaining = () => {
        const budget = deadline - Date.now();
        if (budget <= 0) throw new Error("GitHub policy-read capability check timed out.");
        return budget;
      };
      const rules = await request(
        `/repos/${repository}/rules/branches/${encodeURIComponent(branch)}`,
        remaining(),
        "effective branch rules",
      );
      assertCapabilityArray(rules, "effective branch rules");
      const suites = await request(
        `/repos/${repository}/rulesets/rule-suites?ref=${encodeURIComponent("refs/heads/main")}&time_period=month&per_page=1`,
        remaining(),
        "rule suites",
      );
      assertCapabilityArray(suites, "rule suites");
      const reviews = await request(
        `/repos/${repository}/pulls/${pullNumber}/reviews?per_page=1`,
        remaining(),
        "pull request reviews",
      );
      assertCapabilityArray(reviews, "pull request reviews");
      const checkRuns = await request(
        `/repos/${repository}/commits/${sha}/check-runs?filter=all&per_page=1`,
        remaining(),
        "check runs",
      );
      assertCapabilityArray(checkRuns?.check_runs, "check runs");
    },
    findRecentMergedMainPull: async (requestBudgetMs) => {
      const pulls = await request(
        `/repos/${repository}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100`,
        requestBudgetMs,
        "merged main pull request discovery",
      );
      assertCapabilityArray(pulls, "merged main pull request discovery");
      const pull = pulls.find(isEligibleMergedMainPull);
      return pull ? { number: pull.number, mergeSha: pull.merge_commit_sha } : null;
    },
    getPull: (number, requestBudgetMs) =>
      request(`/repos/${repository}/pulls/${number}`, requestBudgetMs, "pull request"),
    listReviews: (number, requestBudgetMs) =>
      paginate(
        `/repos/${repository}/pulls/${number}/reviews`,
        null,
        requestBudgetMs,
        "pull request reviews",
      ),
    getRuleSuite: async (sha, requestBudgetMs) => {
      const suites = await paginate(
        `/repos/${repository}/rulesets/rule-suites?ref=${encodeURIComponent("refs/heads/main")}&time_period=month`,
        null,
        requestBudgetMs,
        "rule suites",
      );
      const matching = suites.filter((suite) => suite?.after_sha === sha);
      if (matching.length !== 1) {
        throw new Error(
          `Expected one rule suite for main update ${sha}, found ${matching.length}.`,
        );
      }
      return {
        afterSha: matching[0].after_sha,
        ref: matching[0].ref,
        result: matching[0].result,
      };
    },
    getEffectiveRules: async (branch, requestBudgetMs) =>
      extractEffectiveRules(
        await request(
          `/repos/${repository}/rules/branches/${encodeURIComponent(branch)}`,
          requestBudgetMs,
          "effective branch rules",
        ),
      ),
    listCheckRuns: (sha, requestBudgetMs) =>
      paginate(
        `/repos/${repository}/commits/${sha}/check-runs?filter=all`,
        "check_runs",
        requestBudgetMs,
        "check runs",
      ),
  };
}

async function runPreflight({ client, timeoutMs }) {
  const probePullNumber = Number(
    requiredString(process.env.RELEASE_GUARD_PROBE_PR, "RELEASE_GUARD_PROBE_PR"),
  );
  if (!Number.isInteger(probePullNumber) || probePullNumber <= 0) {
    throw new Error("RELEASE_GUARD_PROBE_PR must be a positive integer.");
  }
  const probeSha = requiredString(process.env.RELEASE_GUARD_PROBE_SHA, "RELEASE_GUARD_PROBE_SHA");
  await client.verifyPolicyReadCapabilities("main", probePullNumber, probeSha, timeoutMs);
  console.log(
    "Policy-read capability verified: effective branch rules, rule suites, pull request reviews, and check runs.",
  );
}

async function runUtilityMode({ client, timeoutMs }) {
  const handlers = new Map([
    ["--health", () => runCredentialHealth({ client, now: Date.now, timeoutMs, log: console.log })],
    ["--preflight", () => runPreflight({ client, timeoutMs })],
  ]);
  const selected = [...handlers.keys()].find((flag) => process.argv.includes(flag));
  if (!selected) return false;
  await handlers.get(selected)();
  return true;
}

async function main() {
  const token = requiredCredential(process.env.RELEASE_GUARD_TOKEN);
  const repository = requiredString(process.env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY");
  const timeoutMs = parseGuardTimeoutMs(process.env.STABLE_RELEASE_GUARD_TIMEOUT_MINUTES);
  const client = createGitHubClient({ repository, token });
  if (await runUtilityMode({ client, timeoutMs })) return;
  const eventPath = requiredString(process.env.GITHUB_EVENT_PATH, "GITHUB_EVENT_PATH");
  const expectedSha = requiredString(process.env.EXPECTED_RELEASE_SHA, "EXPECTED_RELEASE_SHA");
  const githubSha = requiredString(process.env.GITHUB_SHA, "GITHUB_SHA");
  const version = requiredString(process.env.VERSION, "VERSION");
  const currentRunId = requiredString(process.env.GITHUB_RUN_ID, "GITHUB_RUN_ID");
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  await runStableReleaseGuard({
    event,
    expectedSha,
    githubSha,
    checkoutSha,
    version,
    currentRunId,
    client,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs,
    initialBackoffMs: INITIAL_BACKOFF_MS,
    maxBackoffMs: MAX_BACKOFF_MS,
    log: console.log,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
