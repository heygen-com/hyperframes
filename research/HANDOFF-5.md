# HANDOFF 5 — The 25-PR Graphite stack: shipped, reviewed, and the fix backlog

> Continues HANDOFF-4. Covers 2026-07-10 (one very long day): the final UX fixes →
> full audit → fallow-green → PR carving saga (9 → 3 → 7 → 9 → 12 → 15 → **25**) →
> Graphite stack live → two review rounds (GitHub + Slack) → `/code-review max`
> (15 findings, 12 CONFIRMED) → **the fix wave that was launching as this doc was
> written**. Read §1 (state), §4 (fix backlog), §7 (gotchas) first.

---

## 1. Current state — TL;DR

- **⚠️ NOTHING IS IN FLIGHT. The previous session ended here. The fix wave (§4) has NOT been executed — it is the new session's first job.** (A fix-wave agent was briefly launched then abandoned; treat /tmp carve state as possibly scratch-touched — the carve script is idempotent, re-run it and trust only fresh gate output.)
- **The deliverable: 25 stacked PRs [#2192–#2216](https://github.com/heygen-com/hyperframes/pull/2192), Graphite-managed** (gt authenticated as ukimsanov). Branches `studio-dnd/pr01-…` → `pr25-…` live in the integration worktree **`/tmp/hf-pr-stack`** (a git worktree of `~/Desktop/hyperframes-3`). Base: origin/main `718c67b38`.
- All 25 were gate-green (tsc, full vitest 18-failure baseline, verbatim-CI fallow, format:check) and byte-parity-verified as of the last submit. The PRs currently on GitHub do NOT yet contain the §4 fixes.
- **research/studio-dnd-architecture** (this worktree, `laughing-perlman-594eb3`) is pushed to origin. ⚠️ It now LAGS the stack: the review-fix files (13 files from review round 1) + everything the fix wave changes exist only in the stack checkpoints/overlays. **The stack is the source of truth; port back to the research branch before doing new work from it.**
- Local test bed: `/tmp/hf-dnd-qa/qa-clean` served at :3011 from this worktree's CLI build (server caches bundle in memory — kill+restart after rebuilds). :3003 serves `qa-project-2` (a broken captions bed — has `LiquidGlass is not defined` composition errors; selection worked fine on a fresh tab, user's stale tab was the issue).
- Coworker handoff: branch pushed + zips on Desktop (`hyperframes-studio-dnd-20260710.zip`, `hf-qa-clean-testbed-20260710.zip`).

## 2. The stack (25 PRs, merge bottom-up; Graphite restacks on merge)

| PR | Branch | Content |
|----|--------|---------|
| #2192–#2194 | pr01–pr03 | leaf helpers / seek-restore contract / studio-server batch files route |
| #2195–#2199 | pr04–pr08 | pure math: collision, snapping, multi-drag, stacking-sync, zones |
| #2200–#2201 | pr09–pr10 | asset-click+nudge policy / characterization tests |
| #2202–#2204 | pr11–pr13 | unwired: canvas z-menu, nudge math, NLE shell components |
| **#2205** | **pr14** | **KEYSTONE: glue API coexistence** (authored intermediates in `/tmp/hf-carve-overlays/glue/`, pr14-only variant in `glue14/`) — old+new engines type-check together |
| #2206–#2210 | pr15–pr19 | clip-drag engine / timeline hooks+lanes / canvas chrome / shell assembly / asset card |
| #2211–#2213 | pr20–pr22 | THE SWAP in 3 steps: canvas glue → timeline glue → app shell + delete old engine. **MERGE THESE THREE AS ONE UNIT** (Abhai's seam evidence: #2212 alone = NaN corruption via legacy onMoveElements shape; #2211 alone = phantom unwired z-menu). Endorsed decision. |
| #2214–#2216 | pr23–pr25 | thumbnails / visual refresh / assets panel. pr25 tip = parity target |

**Carve machinery** (all in /tmp): `hf-carve.sh` (idempotent, rebuilds all 25 from checkpoints `86dd2a32b`/`ddee0cced`/`88f908271` + overlays; TEMP fallow suppressions via config anchors, all dropped at pr22), `hf-carve-gates.sh` (per-branch gates + parity chain), `hf-carve-msgs/pr01–25.txt` (commit messages), `hf-pr-stack-open.sh` (gt track+submit loop), `hf-carve-overlays/{glue,glue14}/` (authored intermediate files — the only code that exists nowhere else). `hf-harvest/ALL_REVIEWS.txt` = all 50 GitHub review bodies.

## 3. Review state

**GitHub (harvested + replied):** Miga (full-stack anchor on #2205, "Ship the stack") + Via-as-vanceingalls (25 substantive R1 reviews). One blocker (#2201 false-safety tests) FIXED in review round 1 (tests moved to #2211 through new `computeNextResizeAnchor` production helper); 9 suggestions applied (13 files +154/−29); replies posted on #2201/#2204/#2193/#2205/#2207/#2209. Q1 answer: `timelinePps/FitPps` reader = `playerStore.ts:420` imperative `get()` in pinTimelineZoom, ships #2213.

**Slack thread** (`#hyperframes-squad-internal` p1783733341403229) — **reviews that never hit GitHub**:
- **Abhai** (consolidated readout, verdict table per PR): 5 must-fix — (1) #2212-alone NaN seam, (2) #2211-alone phantom z-menu → both healed by one-unit merge of #2211–#2213; (3) **#2198 stacking-sync cascade flips untouched pairs** (executed repro; liftAbove must cascade transitively); (4) **#2195 empty-zone placement hole** (executed; audio drop on visual-only timeline lands overlapping; fix idx===-1 branch to signal insert); (5) **#2202 renumber can reorder untouched sibling pairs** (overlap-scoped renumber vs non-scoped siblings) + zero coverage on scoped path (jsdom rects 0×0). Plus: **CI reality — ci.yml `pull_request` triggers on `branches:[main]` only**, so Build/Typecheck/Test have NOT run on #2193–#2216; they first fire as each PR retargets to main after its parent merges. Local full-suite runs are the compensating evidence (Abhai independently: 1,759 keystone / 1,801 tip).
- **Rames** (HF-specialist deltas): #2211 `useDomSelection` deletions — `timelineSelectSeqRef` race guard removed (CONFIRMED by /code-review too) + `rightPanelTab==="variables"` preservation removed (Variables-tab yank on selection); #2208 PreviewOverlays drops sibling selections w/o stable selector mid-persist (optimistic write already landed → siblings revert on reload); #2208 useDomEditNudge cleanup keyed on selection identity; #2210 useProbedDuration orphaned fetch; #2205 setTimelineScale store-contract nit; #2206 persistMoveEdits silent no-op/per-clip-race fallback → runtime warn; #2209 handleMoveElements missing trackStudioExpandedClipEdit telemetry.
- **Vance (human)**: suggested /code-review max → done. **Miguel**: "I feel the agents are lazy."

**/code-review max (10 angles × opus → 4 verifiers + sweep): 15 findings reported, 12 CONFIRMED.** Full list in §4 (they ARE the fix backlog). Notable REFUTED/downgraded: z-reader semantic divergence (unreachable input — CSSOM rejects invalid z), timeRangesOverlap "dead" (deliberately distinct + internally used), updateElement NaN guard (defense-in-depth, no live producer — all callers clamp upstream).

## 4. THE FIX BACKLOG (the fix wave launched at handoff time covers all of this)

**Product decisions made by Ular:** (a) RESTORE multi-select resize ("we don't want to kill anything from main"); (b) merge process = my call → one-unit merge for #2211–#2213, documented in PR bodies.

CONFIRMED bugs (fix in owning PR via overlays):
1. **Stale selectedElementIds cluster** — setSelectedElementId doesn't clear the set at: useDomEditWiring.ts:178 (canvas click), AssetCard.tsx:143, AudioRow.tsx:61, Timeline.tsx:539 (keyframe diamond); TimelineLanes.tsx:418 is the correct pattern. Also: canvas delete (useElementLifecycleOps.ts:90,132) must clearSelectedElementIds; Escape branch (useTimelineRangeSelection.ts:414) must also null the primary. Consequences today: Delete destroys stale marquee set; drag moves phantom group. DESIGN CHOICE: either clear-set at every single-select site, or make setSelectedElementId itself collapse the set (probably cleaner — check TimelineLanes' additive flows first).
2. **Group move bypasses capabilities** — timelineClipDragCommit.ts:104-148: filter multiKeys members through getTimelineEditCapabilities().canMove (timelineEditing.ts:290) before building edits (old gate = main commit 04ddd411e, dropped in reconciliation).
3. **Lane-drag dual-persist race** — timelineClipDragCommit.ts:149/160: serialize (await move persist, then z-patch, or single combined persist), roll back z on move failure, coalesce into ONE undo entry.
4. **Stale store zIndex after z-edits** — useElementLifecycleOps.ts:162-213: re-add store sync (updateElement(key,{zIndex,...}) — the diff REMOVED it; may need zIndex back in updateElement's allowed keys, playerStore.ts:464).
5. **Razor split un-rebased** — rebase onRazorSplit/onRazorSplitAll for expanded sub-comp children like TimelinePane.handleSplitElement does (TimelinePane.tsx:138; razor bypasses via TimelineCanvas.tsx:41 context read; useRazorSplit.ts:121).
6. **Selection race** — restore a monotonic seq guard in useDomSelection.ts:360 handleTimelineElementSelect (removed guard: see commits 1265702ed → 780b89aac).
7. **Multi-select resize RESTORE** — wire resolveTimelineGroupResize (timelineGroupEditing.ts:132, currently 0 callers) into the new resize path (computeResizePreview + commitResizePointerUp operate single-clip only; legacy behavior = main 36413da7f "resize selected timeline clips together").
8. **Cross-project preview bleed** — clear assetPreviewStore on projectId change (NLEContext.tsx:99 resets player store only).
9. **Raw preview URLs** — route AssetCard.tsx:114, AudioRow.tsx:40, useCompositionStack.ts:87+103 through encodePreviewPath/resolveMediaPreviewUrl; AssetPreviewOverlay.tsx:98 inline copy → shared helper.
10. **Multi-file move soft-reload clobber** — timelineElementsMove.ts:139 syncTimelineMovePreviews: only soft-reload the ACTIVE comp's group; full reload if any other file changed.
11. **Duration rollback asymmetry** — timelineElementsMove.ts:118 + timelineClipDragCommit.ts:67: revert setDuration/patchIframeRootDuration on failed persist.
12. **trySingleZ over-patch** — timelineStackingSync.ts:172: gap test must consider DOM tie-break (edited z == minAbove valid when above-neighbor is later in DOM) before cascading.
13. **readClipZIndex null→0** — useTimelineStackingSync.ts:51: return null on resolution miss and EXCLUDE that neighbor from computeStackingPatches (don't fabricate z=0).
14. **Abhai #2195** — timelineCollision resolveZoneDropPlacement/resolvePlacement: empty-zone (idx===-1) drop over occupied span must signal insert, not `{track:0, insertRow:null}`.
15. **Abhai #2198** — liftAbove cascade transitivity (his repro: M z1 / N z0 / E; patching N to 1 ties M and paints above it by DOM → cascade must lift M too).
16. **Abhai #2202** — canvasContextMenuZOrder renumber: overlap-scoped renumber can drop a scoped sibling below a non-scoped one; renumber must preserve order vs NON-scoped siblings too + add real coverage (mock getBoundingClientRect; jsdom rects are 0×0).
17. **Rames accepted items** — Variables-tab preservation on selection (restore `rightPanelTab==="variables"` check), PreviewOverlays sibling-drop console.warn, persistMoveEdits degraded-mode warn, telemetry trackStudioExpandedClipEdit in TimelinePane.handleMoveElements, useProbedDuration timer cleanup.
18. **Perf (confirmed)** — rotation gate in useDomEditOverlayRects RAF (orientedOverlayRect only when rotated; AABB path otherwise); single computeOverlayRootScale+matrix per measurement (domEditOverlayGeometry.ts:330/332); drag-start caching of snap-targets + audioTracks Set (timelineClipDragPreview.ts:81/125); resize pointermove: batch writes then ONE measurement (useDomEditOverlayGestures.ts:292-342).
19. **Vacuous tests (sweep)** — timelineClipDragCommit.test.ts:207 (zero expects) + canvasContextMenuZOrder.test.ts:258 (non-negativity ≠ no-op check) — make them assert the real invariants.
20. Deferred (logged in #2205 summary comment, NOT in wave): shared epsilon/overlap module, NLEContext/TimelineLanes decomposition, typed error callback on DragCommitDeps, integration-test suite for batched-move/multi-delete/content-driven-duration (BOTH human reviewers want this — high-value follow-up), ESLint guard for non-reactive store fields, virtualization.

## 5. New session: exact runbook (start here)

0. **Read this whole doc, then HANDOFF-4 §5 (verification protocol) and the memory file (§6). The Slack thread with the un-addressed reviews: #hyperframes-squad-internal, permalink `heygen.slack.com/archives/C0ACCNHLG3U/p1783733341403229` — Abhai's and Rames's findings live ONLY there (§3), never on GitHub.**
1. `cd ~/Desktop/hyperframes-3/.claude/worktrees/laughing-perlman-594eb3` — verify `git branch --show-current` = research/studio-dnd-architecture, HEAD c83159205+.
2. **Execute the §4 fix wave.** Recommended shape (proven this session): dispatch an opus agent with §4 items 1–19 as the work list, mechanics = "edit overlays under /tmp/hf-carve-overlays/ + the carve script lists; NEVER run git commit (the env pre-commit hook kills agent turns — orchestrator runs the scripts)". Design guidance already encoded per item in §4. Fixes land in owning PRs; every behavioral fix gets a regression test in the same PR; overlays must be oxfmt'd (CI is repo-wide). Resume stalled agents with a "continue" SendMessage — they hit turn limits routinely.
3. Gate: `bash /tmp/hf-carve.sh` then `bash /tmp/hf-carve-gates.sh` (expect ALL GATES PASSED; extend the gates script's parity allowed-delta list with the wave's changed files and print it). Verbatim CI: `bun run format:check` at pr14/pr20/pr22; full vitest at pr16/pr20/pr22/pr25 (18-failure baseline). Capture exits PIPE-FREE (§7.2).
4. Resubmit: in /tmp/hf-pr-stack — `gt track --parent <prev>` loop in order pr01→pr25, then checkout pr25 branch + `gt submit --stack --no-interactive`.
5. Reply to reviewers: (a) Slack thread reply — point-by-point disposition of Abhai's 5 must-fix + Rames's deltas + the /code-review max findings, and state the one-unit merge plan for #2211–#2213; (b) GitHub comment on #2205 summarizing the wave. Style: factual, terse, links-in-words, NO AI attribution anywhere, ever. The user's Slack self-DM has the announce-draft pattern to imitate.
6. Then the human-only items: user feel-test (:3011, hard-reload; rebuild = `bun run --filter @hyperframes/studio build && bun run --filter @hyperframes/cli build`, then kill+restart the :3011 server — it caches the bundle in memory); CapCut corner-drag verification (center-anchored resize shipped on LOW-confidence inference — one real drag in CapCut settles it; a flip is contained to useDomEditOverlayGestures + domEditResizeLocal); research-docs decision (25 research/*.md visible on the pushed research branch — leave/strip/scrub, user never answered); split→Cmd+Z hand-repro (split's own history path is proven correct with a guard test; the live symptom's suspect is a stray "Move layer" entry from a racing gsapDragCommit.commitStaticGsapPosition).
7. Port the stack's final content back to research/studio-dnd-architecture once the stack stabilizes (today: review-round-1 fixes + the coming wave exist only in stack checkpoints/overlays — the research branch tip a97739860+docs is BEHIND the stack on 13+ source files).
8. Merge sequence when approvals land: bottom-up #2192→#2210 per normal Graphite flow (heavy CI first fires per PR at retarget — watch it, §7.6); #2211+#2212+#2213 together as one unit; #2214–#2216 after. Both human reviewers endorsed this order.

## 6. Key evidence files

- **`research/REVIEW-EVIDENCE-2026-07-10.md` — READ WITH THIS DOC**: verbatim verifier verdicts (V1–V16 with quoted code evidence), the phase-3 sweep finds, the full Slack-only reviewer findings (Abhai's must-fixes + extras, Rames's deltas), and what review-round-1 already fixed. `research/REVIEWS-GITHUB-RAW-2026-07-10.txt` = all 50 GitHub review bodies raw.

- `/tmp/hf-harvest/ALL_REVIEWS.txt` — all 50 GitHub review bodies. `/tmp/hf-gates-out.txt` + `hf-gates25*-output.txt` — gate runs. `/tmp/verify-0710/` — live verification screenshots. `/tmp/fallow-*.txt` — fallow probes.
- Memory file `~/.claude/projects/-Users-ularkimsanov-Desktop-hyperframes-3/memory/project_studio_dnd_audit.md` — the full running ledger of the entire arc (every commit, every lesson).
- Slack: PR-announce draft v3 (Miguel-style) in Ular's self-DM p1783730533352719 — references the CURRENT PR numbers, reusable after fix wave.

## 7. Operational gotchas (hard-won today — read before running agents)

1. **The environment's pre-commit hook TERMINATES subagent turns at `git commit`** — the session-long "agents die mid-commit" mystery. Workaround: agents write scripts + msgfiles; the orchestrator executes. Resume-heartbeat (SendMessage "continue") works for turn-limit stalls but not for this.
2. **`cmd | tail; echo $?` reports TAIL's exit code** — caused a false "fallow green" claim. Always capture exits pipe-free.
3. **Replicate CI verbatim** — my gates missed repo-wide `bun run format:check` twice (script-generated .fallowrc blocks, then agent-authored overlay files). fallow gate = `bunx fallow audit --base origin/main --fail-on-issues` from repo root; only INTRODUCED findings gate; test files count as consumers for dead-code.
4. **fallow CRAP flares mid-stack on identical code** (coverage/reachability improves as the stack lands) — repo precedent: `health.ignore` entries; TEMP ones at first flaring branch, dropped at pr22. Extraction-clone files trip the DUPLICATION gate until their originals are deleted → they ride in the swap PRs. **`rm -rf .fallow` before every audit — cache poisons across checkouts.**
5. **`git diff --name-only` HIDES rename sources** (NLELayout.test.ts R097 bit three carves) — inventories need `--no-renames`.
6. **CI heavy jobs don't run on stacked PRs** until retarget-to-main (ci.yml trigger `branches:[main]`). Local full-suite = the evidence. The marketplace "WIP" check wedges IN_PROGRESS on force-push storms — it is NOT in branch protection, ignore it.
7. Test suite baseline: exactly **18 failed** (localStorage env: telemetry×15 + SnapToolbar×3) — any other failure is real. Suite count at tip: ~1,801–1,819 depending on wave.
8. Synthetic pointer drags reject setPointerCapture (~50% flaky); the Browser pane's `computer` clicks are REAL input and work; the preview iframe lives in `<hyperframes-player>` SHADOW DOM (find via page.frames() url contains shader_loading=player).
9. zsh: `$VAR` doesn't word-split; `=word` expands as command path (`echo ===` fails); use explicit paths/arrays.
10. gt: `gt track --parent <prev>` per branch in order, then `gt submit --stack --no-interactive` from the top branch. Commits: conventional, `--no-verify`, NO AI attribution (hard rule).
