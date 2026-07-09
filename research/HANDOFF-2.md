# HANDOFF 2 — Audit + 5 targeted fixes (continues `research/HANDOFF.md`)

> **Read `research/HANDOFF.md` first.** It's the prior session's full arc of the
> `research/studio-dnd-architecture` branch (the ~48-commit, CapCut-parity Studio
> timeline + drag-and-drop work). Nothing there is stale. This doc = only what
> the _audit session_ changed on top of it.

---

## 0. TL;DR — current state

- Branch `research/studio-dnd-architecture`, worktree
  `/Users/ularkimsanov/Desktop/hyperframes-3/.claude/worktrees/laughing-perlman-594eb3`.
- **48 commits ahead of `origin/main`, 26 behind, nothing pushed.**
- **HEAD is unchanged at `50ef6a79e`** (the prior handoff commit) — this session
  added **no commits**. The work is **uncommitted in the working tree.**
- Uncommitted diff = **6 files, +73 / −14** — five tight bug fixes (§2).
- Everything else this session explored was **reverted into `git stash`** (§4).
- Builds clean; `tsc`/`oxlint` clean; full studio suite **1433 pass / 18 fail**
  (the 18 are pre-existing env failures — not the branch; see §3).

The point of the session was: **audit the DnD/timeline work per HANDOFF.md, fix
what's broken.** We did that, briefly over-built, then trimmed back to 5 real fixes.

---

## 1. What the audit found (verified)

- The prior handoff is **honest**. The DnD experience it describes is really there.
- **Two real bugs** (now fixed — §2): track oscillation (F1) and an invalid `-1`
  insert track (F2).
- The **"checkpoint PR" the prior handoff recommends would fail CI** in its full
  form: `filesize` (only if the big TimelineCanvas changes are kept — they are NOT
  in the current 5-fix set), `fallow` (exit 1), and `format` (unformatted research
  docs). Also the branch is **26 commits behind `main`** — **rebase before any PR.**
- The **18 "pre-existing" test failures are genuine and not the branch's fault**:
  `window.localStorage` is `undefined` in the happy-dom test env (hits
  `telemetry/client`, `telemetry/distinctId`, `SnapToolbar`). Don't chase them.

---

## 2. The 5 fixes kept (the uncommitted diff)

| #   | Fix                                           | File(s)                                                 | What / why                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Track oscillation**                         | `player/components/timelineZones.ts` (+ `.test.ts`)     | `resolveMainOriginTrack` tie-broke on the **track index**, which `normalizeToZones` mutates every pass → two equal-duration videos on different tracks swapped lanes on every re-zone/reload. Now tie-breaks on the **stable clip id** (invariant). Regression test added. Proven both by unit test and live reload.                                                                                                                                                                   |
| F2  | **Invalid `-1` insert track**                 | `player/components/timelineCollision.ts` (+ `.test.ts`) | `buildTrackInsert` row 0 returned `trackOrder[0] - 1` = `-1` when inserting above the top lane (negative track index → briefly corrupts persisted source). Now shifts every other clip down one and the dragged clip takes the top index. Test updated (it had encoded `-1` as "expected").                                                                                                                                                                                            |
| Z   | **Timeline fills the viewport**               | `player/components/Timeline.tsx`                        | When content is shorter than the visible width (e.g. zoomed out), the ruler + empty track lanes now **continue into the space** instead of leaving dead black on the right — CapCut-style always-present timeline. `displayContentWidth = max(content, viewport)`, `displayDuration` feeds `generateTicks`. Zoom-out still works (no "fit floor"). Only the _rendered_ extent grows — clip positions are untouched. Verified live (canvas 1678 in a 1680 viewport, ticks to the edge). |
| C1  | **Selection outline stays during drag**       | `styles/studio.css`                                     | `.is-dragging`'s drop-shadow was overriding `.is-selected`'s white outline. Added `.timeline-clip.is-selected.is-dragging` re-stating both.                                                                                                                                                                                                                                                                                                                                            |
| C2  | **Audio clip not transparent while dragging** | `styles/studio.css`                                     | The drag ghost had no solid background, so audio clips (waveform on a separate layer) looked see-through. Added a solid `background-color` to `.is-dragging`.                                                                                                                                                                                                                                                                                                                          |

All verified: `tsc --noEmit` clean, `oxlint` clean on touched files, 81 tests pass
across the touched files, `bun run build` clean, fill-timeline + F1 confirmed in
the browser.

---

## 3. What was explored then REVERTED (in the stash — do not assume it's applied)

Stashed at `git stash` top, message **`session-2026-07: audit fixes +
zones/packing/R3/drag-model (selective re-apply)`** (find it with
`git stash list | grep session-2026`). Recoverable if you ever want to pursue it
properly. It contains, entangled together:

- **Lane packing** — collapse the one-clip-per-track sprawl (e.g. 48 lanes → ~14)
  by packing non-overlapping clips onto shared lanes.
- **Main-track detection rewrite** — pick "main" by biggest _content_ lane
  (sub-comps count), not longest raw `<video>`.
- **R3** — taller main track (variable per-track heights) + sticky ruler.
- **No-overlap / parallel-drop drag rewrite** — land where you drop, snap flush
  past occupied clips, never stack (removed `resolvePlacement`/`isLaneFree`).
- Zoom playhead-anchor, thinner insertion line, `TimelineCanvas` filesize split,
  research-doc reformatting.

**Why it was dropped:** it drifted well past "audit + fix," and the track-model
parts hit a real unresolved bug (§5). The user chose to keep only the 5 fixes.

---

## 4. Environment / run (mostly per HANDOFF.md §2–3)

- `bun` only. Lint/format: `bunx oxlint` / `bunx oxfmt`.
- **`bun run build`** (full) refreshes the CLI-embedded studio bundle — required
  after any studio change (a studio-only build doesn't update what `preview` serves).
- Preview: `node packages/cli/dist/cli.js preview --no-open --port=3008 <project>`.
- Browser harness = `mcp__Claude_Preview__*`. **`launch.json` had to be created in
  the _running_ worktree's `.claude/`** (see §5 worktree trap), pointing at
  laughing-perlman's `cli.js` + the project.
- **Real busy test project:** `/Users/ularkimsanov/Desktop/hyperframes-launches/skills-launch-video`
  (48 clips — good for edge cases + vertical scroll). The `/tmp/hf-dnd-qa/*` beds
  are **mangled** from synthetic drag testing — recreate a clean one if needed.
- Tests: `cd packages/studio && bunx vitest run [path]`.

---

## 5. Gotchas learned this session (don't re-discover)

- **Wrong-worktree trap.** The code is in the `laughing-perlman-594eb3` worktree,
  but a session can be launched from a _different_ worktree (`zen-bartik-4c8cf2`).
  Confirm `git -C <worktree> branch --show-current` = `research/studio-dnd-architecture`
  before anything. Edit via absolute paths into that worktree; the browser
  harness roots itself in the launching worktree, so its `launch.json` lives there.
- **HyperFrames tracks ≠ NLE tracks.** Track index is timeline-_organization_ only;
  on-screen layering is **CSS `z-index` + DOM order**, independent of track number.
  Generators emit one clip per track (the 48-lane sprawl) — harmless to render,
  ugly in the editor. (That's what lane-packing in the stash addresses.)
- **Main-track detection is fragile for sub-comp compositions.** The committed
  heuristic ("longest `<video>`") crowns the wrong thing when the real content is
  sub-comps. The stash's "biggest content lane" rewrite fixes that BUT hit a
  **raw-vs-expanded inconsistency**: `normalizeToZones` zones the _raw_ clips
  (sub-comp = 1 clip) while the tall-lane pick (`resolveMainOriginTrack` in
  `Timeline.tsx`) reads the _expanded_ clips (sub-comps blown open) — they disagree
  on "biggest." **Reconcile those two before any main-track-position work.**
- **Synthetic DnD in the harness is async-flaky AND mutates the project** (each
  drag persists to the file). Reset beds between runs. **The drag _feel_ is best
  judged by a human** — I couldn't reliably auto-verify it.

---

## 6. Open decisions / suggested next steps

1. **Commit the 5 fixes** — not yet committed (user hadn't decided). They're small,
   isolated, and verified; a clean `fix(studio): ...` commit each, or one grouped.
2. **Feel-test the drag** in the browser (the one thing not auto-verifiable).
3. **Before any checkpoint PR:** rebase onto current `main` (26 behind), then re-run
   `fallow` + `filesize` + `format:check` (the 5-fix set is only 6 files, so those
   gates may already be clean now — re-check rather than assume).
4. **Design questions still open** (deferred): how "main" is chosen (explicit
   `data-timeline-role="main"` vs a heuristic), and whether to pin the main lane to
   the bottom (CapCut) — both got messy; parked with the stash.

---

## 7. Memory

Auto-memory saved: `project_studio_dnd_audit.md` (audit findings + the 5 fixes),
indexed in `MEMORY.md`.
