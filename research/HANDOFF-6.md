# HANDOFF-6 — Merge-train wreckage map, the golden branch, and how to finish (2026-07-12)

> Continues HANDOFF-5. Covers 2026-07-11→12: six fix waves shipped through review, the stack
> restacked onto main, the merge train started — and then a chaotic multi-driver merge phase
> (deletion races, mid-stack mis-merges by Miguel's agent, PR resurrections). **Code-wise nothing
> is lost.** Read §1, then §2 for the one branch that matters, then §5 for gotchas.

## 1. TL;DR state

- **All engine work is DONE, reviewed (5 rounds), and conflict-free.** Six fix waves: §4 backlog
  (wave 1), Ular's feel-test fixes (wave 2: playhead no-follow, 00:MM, duration floor, unsafe-id,
  split-undo SDK resync, soft undo restore), re-review responses (wave 3: GSAP-shift blocker,
  free-aim hoist, coalesceMs, menu gating, NaN guards), marquee preserveSet + insert-band geometry
  (wave 4), **STABLE TRACK LANES rewrite** (wave 5 — user product decision: lane = data-track-index,
  z = paint order only, one-clip writes; resolveDropIntentZ deleted), Abhai round-3 blockers
  (wave 6: NUL joiner, edge-create zone gate, de-nest of 8 silently-unregistered tests) + the
  DOMParser duration-regex refactor. All verified: per-branch gates (tsc/full-suite-18-baseline
  with count assertion/fallow-zero-suppressions/format/filesize/builds) + pointer-driven browser
  verification with one-element file-diff invariants.
- **Merged into origin/main** (tree-verified, don't trust PR labels): pr01–pr05, pr07 layers
  (via #2192, #2193, #2268, #2195, #2269-recovery, #2270-recovery). main also absorbed 78 unrelated
  commits + v0.7.53/54 releases; our restack + per-merge syncs handled all drift.
- **NOT in main**: pr06 and pr08–pr25 layers. All content safe (see §2/§3).
- The PR fleet is chaos (mis-merges into branches, closed cars, recovery PRs) — §3 maps it, but
  the next session can IGNORE the fleet entirely if it uses the golden branch.

## 2. THE GOLDEN BRANCH — start here

`origin/studio-dnd/consolidated-tip` = **every unmerged layer (18 commits: pr06 + pr08–pr25),
rebased clean onto current origin/main, tsc 0, no conflicts.** Pushed. This is the single source
of truth for all remaining code. Options for the new session:
  (a) keep rescuing the existing PR fleet (§3 order) — preserves 11 APPROVED stamps; or
  (b) nuke the fleet and re-carve fresh PRs from consolidated-tip (loses stamps, cleanest); or
  (c) one big PR from consolidated-tip (loses stack review granularity; team call).
Whichever — rebase it onto main again right before use (squash-merge drift; merged patches
auto-drop, historically always clean).

## 3. PR fleet map (as of handoff; verify before trusting — Miguel's agent may act again)

- MERGED into main for real: #2192(pr01) #2193(pr02) #2268(pr03; #2194 is its zero-byte ghost,
  reopened, open, mergeable — merge or close, cosmetic) #2195(pr04) #2269(pr05 recovery)
  #2270(pr07 recovery).
- **MIS-MERGED (labeled MERGED but went into their mid-stack BASE BRANCH, NOT main)**:
  #2197(pr06→pr05 branch), #2199+#2200(pr08,09→pr07 branch), #2202(pr11→pr10 branch),
  #2204(pr13→pr12 branch). GitHub PRs merge into their base branch — mid-stack merges are dead ends.
- Race-closed unmerged: #2196, #2198, #2201, #2203, #2205 (branches survive with content).
- **Recovery cars OPEN (verified content == approved originals), merge order:**
  #2271(pr06) → #2276(pr08+09 consolidated, from polluted pr07 branch) → #2277(pr10+11, supersedes
  agent's #2272) → #2278(pr12+13, supersedes #2273) → #2275(pr14, agent's, content ok).
- **Upper stack OPEN + APPROVED (the crown jewels — do not force-push these branches, stamps die):**
  #2206–#2216 (pr15–pr25). Merge bottom-up AFTER recoveries, retargeting each base to main
  IMMEDIATELY before its merge.

## 4. Durable refs & paths

- Branches (in ~/Desktop/hyperframes-3 .git, shared by all worktrees; /tmp worktrees disposable):
  studio-dnd/pr04..pr25 (synced), studio-dnd/consolidated-tip (golden), backup/restack-pr* +
  backup/chain2..6-pr* (every intermediate state), origin has all + recovery/* branches.
- Worktrees: /tmp/hf-pr-stack (stack ops), /tmp/hf-fixwave/int (pre-restack integration tree),
  /tmp/hf-fixwave/{a..m} (agent sandboxes) — all disposable, content is in the branches.
- Evidence: /tmp/hf-fixwave/INTEGRATION-PLAN.md (full wave ledger), /tmp/hf-fixwave/reports/*.md
  (every agent report incl. restack-pr20 conflict rationale), gates outputs /tmp/hf-gates-*.
  These are /tmp — copy out if wanted; the durable narrative lives in #2205's comment thread.
- Gates: /tmp/hf-carve-gates.sh still works per-branch (parity retired). Carve machinery RETIRED.

## 5. Gotchas (blood-bought — read before touching the train)

1. **A stacked PR merges into its BASE BRANCH.** Retarget to main FIRST, merge second. Always.
2. **Auto-delete-head-branches races GitHub's child retarget** → child closes. Watcher pattern:
   poll merge, PATCH child base=main within seconds (proven on #2268→#2195). Or disable the
   repo setting (admin).
3. **Closed-unmerged PR + head force-pushed while closed = reopen blocked** … UNLESS you
   force-push the EXACT closure-time head SHA back (gh api .head.sha), then reopen works
   (proven on #2194). Head moved forward normally (added commits) may also block; base branch
   must exist at reopen. MERGED state is permanent — no un-merge ever.
4. **Squash-merges drift the chain** → after every merge: rebase remaining chain onto main
   (merged patches auto-drop), force-push. gt refuses when a tracked branch maps to a closed PR
   (raw git push works).
5. **Graphite mergeability_check is OPTIONAL** — not in required checks; never blocks GitHub
   merges; wedges on dead PR numbers in its server graph. Ignore it or fix via org settings.
6. **"Dismiss stale approvals" hazard**: pushing to an approved branch may nuke stamps —
   hence rule: never push pr15–pr25 branches again.
7. CI: heavy matrix fires only when a PR is based on main (retarget) — ~20min/car; the 4-second
   "regression" job deaths are a rerunnable artifact; roaming happy-dom flake = 
   offCanvasIndicatorRefresh (passes solo).
8. Verification law (learned hard): suites+gates are NOT feel-verification. Any timeline/canvas
   UX change ⇒ pointer-drive a real project (bed: cp of claude-design-hyperframes-video;
   serve via `node <tree>/packages/cli/dist/cli.js preview <bed> --port=3025`) + file-diff the
   one-element invariant.

## 6. Remaining work

- Land the code: §3 order (or golden-branch alternative). Then: lift release hold.
- Post-land: port final state to research/studio-dnd-architecture; retire/annotate #2194 ghost;
  close superseded #2272/#2273; Slack post-mortem (drafts in /tmp/hf-fixwave/drafts/).
- User-only: strip stray z-indexes from ~/Desktop/hyperframes-launches/claude-design-hyperframes-video
  (buggy-build damage; backup first — was permission-gated), CapCut anchor confirm, research-docs
  visibility decision, M's product calls (lane order for non-overlap = RESOLVED by stable-track;
  tight-gap z fallback still open).
- Watch: Miguel's agent must stay off the repo until the fleet is resolved.

## 7. POST-HANDOFF UPDATE (minutes later — final state at session end)
"Continuation" PRs (#2279, #2285–#2287, by Miguel's agent) landed roughly layers pr06–pr11 — BUT
tree-checks show at least pr08's timelineZones.ts and the pr10 test landed as STALE versions
(pre-final-wave content). pr12–pr25 entirely absent from main. Consequence: DO NOT trust main's
file presence as layer-completeness — diff against consolidated-tip is the only truth, and merging
consolidated-tip content both finishes the remaining layers AND repairs the stale copies.
consolidated-tip was rebased onto main BEFORE these continuations — rebase it again first thing.
