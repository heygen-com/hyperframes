# Studio Flat Inspector — Session Log 2026-07-13

Worktree: `~/src/wt/hyperframes/de-split`. Continuation of the flat-inspector redesign stack (PRs #2120–#2190, plans in this directory dated 07-08/07-09).

## 1. Slider live-update bug (PR #2190) — investigated, held back

- User reported: dragging a slider (Layer blur on image/video clip) shows a wrong live value; correct value appears only after deselect. Reliable on their machine; **never reproduced** via scripted `agent-browser` testing (trusted CDP mouse events, sub-40ms synthetic drags, every cadence tried).
- Shipped defensively on PR #2190 branch: draft-state + **debounce** (commit `76bfce25f`), then discovered the debounce itself killed real-time preview during continuous drags (timer resets every pointermove) and replaced with a **throttle** — leading-edge commit + 40ms trailing flush (`0e39019f4`).
- Side-by-side comparison against the **published studio** (npm `hyperframes` 0.7.46, legacy `SliderControl` native range input) showed the same symptom class exists there too → **NOT a regression from the flat-inspector work; pre-existing**. User said stop; throttle commit stayed local, later pushed as part of the stack update.
- Memory saved: `project_flatslider_debounce_not_root_cause.md`. If this bug resurfaces, start fresh — suspect the live-preview GSAP patch path (`gsapLivePreview.ts` / `useGsapScriptCommits`), not `FlatSlider`.
- Key testing gotchas confirmed this session: synthetic `dispatchEvent` pointer events **cannot acquire pointer capture** in real Chromium (happy-dom allows it, browsers don't); `agent-browser mouse` per-call latency can't reach sub-40ms cadence, so throttle timing is only provable in unit tests.

## 2. Stack rebase onto main + conflict fix

- Rebased `studio-flat-01-foundation-text` onto latest `origin/main`; one real conflict in `StudioRightPanel.tsx` (main added the `DesignPanelPromoteProvider` wrapper; our commit added group-selection/hide-all wiring) — merged both. `gt restack` rippled through all 14 branches cleanly.
- `main` is checked out in another worktree → never `git checkout main`; use `git fetch origin main && git update-ref refs/heads/main FETCH_HEAD` before `gt submit`.
- Force-pushed the whole stack (`gt submit --no-edit --no-interactive --stack`); all 14 PRs updated.
- Reviewer feedback checked: 13/14 approved (miga-heygen full-stack review + miguel-heygen per-head passes). #2120 had a stale CHANGES_REQUESTED (merge conflict) — resolved by the rebase, commented for re-review. CI green 32/32.
- 55 test failures in `sdkResolverShadow` / `sdkCutoverParity` / `sdkCutover` / `useGsapPropertyDebounce` / `variablePromoteIntegration` are **pre-existing on main**, zero overlap with the stack. Ignore them; the studio baseline is "55 failed, rest pass".

## 3. Max-effort code review → 15 confirmed defects → all fixed (PR #2225)

50-agent workflow review (6 finder angles → 41 adversarial verifiers) over `origin/main...HEAD`; 46/48 candidates confirmed, collapsed to 15 distinct bugs. All fixed in **PR #2225** (`studio-flat-15-review-fixes`, one commit `77e59e87a`, stacked on #2190; state OPEN/MERGEABLE). Full finding-by-finding detail in the PR description.

Fixes, by file:

- `StudioRightPanel.tsx` + `timelineTrackVisibility.ts`: "Hide all" resolved bare DOM ids against scope-qualified timeline keys (silent no-op) AND raced N concurrent file writes (lost update). Now `timelineKeysForSelections` (new helper in `studioHelpers.ts`) + `toggleTimelineElementHidden` accepts `string[]` → one atomic write via the existing `setElementsHidden` batch path.
- `PropertyPanel.tsx` + `PropertyPanelEmptyState.tsx`: remount/React keys used `id ?? selector`, colliding for id-less same-selector siblings (stale grading state committed onto the wrong element). Now the 4-part `id|hfId|selector|selectorIndex` identity, extracted as `selectionIdentityKey` in `propertyPanelHelpers.ts` (deduped with legacy ColorGradingSection call site).
- `propertyPanelFlatTextSection.tsx`: restored `PromotableControl` wrappers around Content / text Color / Font family — variable bindings and promote-to-variable ("◇ var") work in flat mode again.
- `propertyPanelFlatStyleSections.tsx`: Mask select showed authored custom `clip-path` as "none" with a live reset → one click destroyed it. Now shows "custom" (re-select = no-op).
- `propertyPanelFlatMotionSection.tsx`: editing Duration/End on an inferred (animation-derived) range flipped inference off and shifted start to 0; editing Start looked dead. Any edit on an inferred range now pins BOTH `data-start` and `data-duration` (sequential awaits).
- `gsapLivePreview.ts`: live 3D-drag resolved first `querySelector` match; now honors `selectorIndex` (`resolvePreviewNode`).
- `propertyPanelFlatPrimitives.tsx` (FlatSlider): missing `disabled` guard on pointerup (disabled sliders committed); mid-drag prop echo reset draft (knob snap-back — fixed with `draggingRef`, plus `onPointerCancel`); reset button only rendered under `centerTick` (all Grade non-centerTick resets dead — now `centerTick || onReset`); no keyboard access (now `tabIndex`, `aria-valuemin/max`, Arrow/Page/Home/End via `sliderKeyTarget`).
- `useColorGradingController.ts`: transient `/media/metadata` fetch failure cached `null` forever, permanently suppressing the HDR banner — failures no longer cached.
- `PropertyPanelFlat.tsx`: Style summary `|| 1` falsy-zero showed opacity 0 as 100% (now `Number.isFinite` guard); removed the lying "drag values to scrub" Layout accessory (FlatRow has no scrubbing).

New regression tests (5): batch hide = one atomic write + "Hide 2 elements" label; disabled-release no-commit; keyboard operation; mid-drag echo no-snap-back; non-centerTick reset reachable. Suite: **1689 passed** + the known 55.

Build-gate lessons (lefthook): `rtk`-wrapped `git commit` silently no-ops — use `/usr/bin/git commit`. Filesize gate = 600 lines/file (drove the helper extractions above). Fallow complexity gate caught two arrows → extracted `resolvePreviewNode` and `sliderKeyTarget`.

## 4. Section styling tweak — UNCOMMITTED

Per user: headers vs open-section body need slightly different colors; body lighter + inset shadow.

- `tailwind-preset.shared.js`: new token `panel."bg-inset": "#121214"` (headers stay `panel-bg` `#0C0C0E`).
- `PropertyPanelFlat.tsx` open-group body div: `bg-panel-bg-inset shadow-[inset_0_2px_4px_-1px_rgba(0,0,0,0.5)]`.
- Live-verified (computed style: `rgb(18,18,20)` + inset shadow). **These 2 files are dirty in the worktree — not committed, not reviewed.**

## 5. Dev-loop mechanics (how to run all this)

- Flat inspector is OFF by default — baked in at Vite build time. A plain `hyperframes preview` shows the LEGACY panel (this bit us once).
  ```bash
  cd ~/src/wt/hyperframes/de-split/packages/studio && VITE_STUDIO_ENABLE_FLAT_INSPECTOR=true bunx vite build
  cd ../cli && node scripts/build-copy.mjs        # copies studio dist into cli dist (don't run parallel with tsup)
  cd <project-dir> && node ~/src/wt/hyperframes/de-split/packages/cli/dist/cli.js preview --force-new
  ```
- Test project: `/private/tmp/claude-501/-Users-vanceingalls-src-hyperframes/c653a869-1f02-4525-b928-1a8a37b4cdaa/scratchpad/flat-inspector-demo` (has Title Text / Image Clip / Video Clip + color-grading wrappers; known benign `gsap_from_opacity_noop` lint warning). Server was last on `localhost:3004`.
- Stale localStorage once made the timeline render empty ("Drop media here", 0:00 duration) while the iframe was actually fine — `localStorage.clear(); sessionStorage.clear()` + reload fixed it. Check before debugging "composition won't load".
- Published-studio comparison: plain `hyperframes preview` (global npm 0.7.46) on the same project, lands on the next free port.

## 6. Open items

1. **Commit + PR the section styling** (item 4) once user approves the look.
2. **PR #2120 re-review** — asked miguel-heygen to clear the stale conflict blocker; confirm it flips to approved.
3. **PR #2225 review** — fresh, unreviewed.
4. **Manual validation of the 15 fixes** — only unit-tested + spot-checked live. Worth hand-validating: multi-select "Hide all" (needs 2+ selected elements), variable-bound text promote/edit round-trip, custom clip-path mask survival, inferred-timing edits, keyboard sliders, disabled-slider click.
5. **Original slider live-value bug** — unexplained, pre-existing, reproducible only by the user. Parked.
6. Separate branch `fix/manual-edit-live-preview-stale` (SSE-suppression timestamp race, commit `57ced0bf6`, reviewed+approved, based on origin/main) — **still not submitted as a PR**; submit only when asked.
