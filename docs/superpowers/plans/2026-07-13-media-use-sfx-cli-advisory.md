# Media-use SFX CLI Advisory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface an actionable install/update advisory when bundled SFX succeeds specifically because the HeyGen CLI is missing or outdated.

**Architecture:** Extend the existing HeyGen error classifier with process-local remediation state, consume it only after `bundled.sfx` wins, and expose it through the existing result formatter. Preserve successful fallback, existing stderr diagnostics, telemetry, and provider ordering.

**Tech Stack:** Node.js ESM, `node:test`, media-use resolver CLI, generated skills manifest.

---

### Task 1: Pin remediation state behavior

**Files:**
- Modify: `skills/media-use/scripts/lib/heygen-cli.test.mjs`
- Modify: `skills/media-use/scripts/lib/heygen-cli.mjs`

- [ ] **Step 1: Write failing tests**

Add tests that call `reportHeygenFailure` with `ENOENT`, an outdated-version error, and a non-actionable error, then assert a new `consumeHeygenRemediation()` returns `{ code, message }` once for only `not_found` and `outdated`.

- [ ] **Step 2: Verify RED**

Run: `node --test skills/media-use/scripts/lib/heygen-cli.test.mjs`
Expected: FAIL because `consumeHeygenRemediation` is not exported.

- [ ] **Step 3: Implement minimal state**

Store the latest `not_found` or `outdated` result inside `reportHeygenFailure`; export a consume-once function that returns and clears it. Do not store auth, quota, network, or generic failures.

- [ ] **Step 4: Verify GREEN**

Run the same test; expected: PASS.

### Task 2: Attach the advisory only to implicit bundled fallback

**Files:**
- Modify: `skills/media-use/scripts/resolve.test.mjs`
- Modify: `skills/media-use/scripts/resolve.mjs`

- [ ] **Step 1: Write failing resolver tests**

Add subprocess cases for missing CLI and outdated CLI that resolve bundled SFX and assert `advisory.message` contains the canonical install/update command. Add negative cases for `--local-only`, `--provider bundled.sfx`, and a healthy catalog miss.

- [ ] **Step 2: Verify RED**

Run: `node --test skills/media-use/scripts/resolve.test.mjs`
Expected: FAIL because successful JSON results do not contain `advisory`.

- [ ] **Step 3: Implement result plumbing**

After provider resolution, consume remediation only when the winner is `bundled.sfx`, the run is not local-only, and no provider override was supplied. Attach it to the record/result; print a concise human hint and include the structured object in JSON.

- [ ] **Step 4: Verify GREEN**

Run the resolver test; expected: all cases PASS.

### Task 3: Regenerate and verify

**Files:**
- Modify: `skills-manifest.json`

- [ ] **Step 1: Format changed files**

Run `bunx oxfmt` on the four changed source/test files.

- [ ] **Step 2: Regenerate manifest**

Run: `bun packages/cli/scripts/gen-skills-manifest.ts`

- [ ] **Step 3: Run required checks**

Run:

```bash
node --test skills/media-use/scripts/lib/heygen-cli.test.mjs skills/media-use/scripts/lib/registry.test.mjs skills/media-use/scripts/resolve.test.mjs
bun run lint:skills
bun run test:skills
bun run format:check
bun packages/cli/scripts/gen-skills-manifest.ts --check
```

Expected: zero failures and an in-sync manifest.

- [ ] **Step 4: Commit and push**

Commit the implementation and generated manifest, push to `fix/media-use-bundled-sfx`, then wait for PR #2257 CI to become terminal and green.
