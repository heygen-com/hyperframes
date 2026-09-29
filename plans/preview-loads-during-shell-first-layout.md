# Preview loads during the shell's first layout

**Path:** `plans/preview-loads-during-shell-first-layout.md`
**Repo:** heygen-com/hyperframes · measured against v0.8.35
**Status:** proposal, needs owner decisions (see Open questions)

Every claim below is tagged **[fact]** (read from the code or the trace), **[inference]** (reasoning from those facts, falsifiable), or **[recommendation]**.

---

## Problem

**[fact — measured, not re-derived here]** On a cold open of a project, the Studio shell's first text layout is a single synchronous **3.04 s** task (`FontFaceSet::HandlePendingEventsAndPromisesSoon` → forced style+layout, 9 dirty objects, `preFCP`). Measured at 3.8 s idle, 11.9 s under machine load, ~20 s as experienced. It reproduces on a bare `<p>hi</p>` page in a fresh renderer: **it is Chrome plus machine load, not our CSS.**

The preview iframe is created by React _after_ the shell renders, so the composition's own load (~1.5 s) is serialised behind the stall:

```
+0.00s studio shell commits
+0.21s Layout 3.04s  (shell, 9 objects)   ← stall
+3.36s preview iframe element created
+4.10s preview document commits           (0.74s of server + network)
+4.53s preview layout 0.03s               (1,602 objects)
```

Nine dirty objects taking 3.04 s is the tell: the cost is not proportional to our DOM. We cannot shrink it. We can stop paying it _and then_ paying for the preview.

---

## Goal and non-goals

**Goal.** Time-to-first-preview-frame is bounded by `max(stall, composition load)` rather than `stall + composition load`, by starting the composition's load before the stall begins.

**Non-goals.**

- Shrinking the 3.04 s stall. See "Why fonts is a dead end" — there is nothing of ours in it.
- Any change to the `<hyperframes-player>` public API, its attributes, events, or lifecycle. **[fact]** None of the recommended units touch `packages/player/**` at all.
- Any change to deterministic render or export. The preview route (`/api/projects/:id/preview`) is already the studio-only path; the render path goes through the producer.
- Making the preview _itself_ faster (its 30 ms layout is not the problem).

---

## Current flow (cited)

### Where the element and the iframe are created

1. `packages/studio/src/main.tsx:96` — `createRoot(#root).render(<StudioApp/>)`. The entry is `<script type="module" src="/src/main.tsx">` (`packages/studio/index.html:11`), i.e. **deferred**: it runs after HTML parsing.
2. `packages/studio/src/App.tsx:453` — the entire shell is gated: `if (resolving || waitingForServer || !projectId) return <StudioSplash/>`. **[fact]** `useServerConnection` (`packages/studio/src/hooks/useServerConnection.ts:26-66`) contacts `/api/projects` **even when the hash already names a project** — the hash id is used, but only after the fetch settles.
3. `App.tsx:497` → `EditorShell` → `packages/studio/src/components/EditorShell.tsx` → `nle/PreviewPane.tsx:125` → `nle/NLEPreview.tsx:467` → `player/components/Player.tsx`.
4. `packages/studio/src/player/components/Player.tsx:158-282` is where the DOM work happens, inside `useMountEffect` (a plain `useEffect`, `hooks/useMountEffect.ts:15`):
   - `:163` `previewSource = directUrl || buildProjectApiPath(projectId, "/preview")`
   - `:170` `await import("@hyperframes/player")` — a **dynamic import**, deliberately deferred to the browser (comment at `:6-8`: a module-scope import registers a custom element and throws under SSR)
   - `:174` `document.createElement("hyperframes-player")`
   - `:273-274` `shader-capture-scale="1"`, `shader-loading="player"` — **hard-coded constants**
   - `:281-282` `setAttribute("src", src)` then `container.appendChild(player)`
5. `packages/player/src/hyperframes-player.ts:220-236` — `attributeChangedCallback` for `src` **bails when `!isConnected`** (`:227`). So the navigation actually starts in `connectedCallback` (`:177-189`), on the `appendChild` at `Player.tsx:282`, via `prepareSrcForElement`.
6. `packages/player/src/iframe-dom.ts:39-55` — `createCompositionIframe()` builds the iframe in the element's **constructor** (`hyperframes-player.ts:121`), inside the shadow root. There is no seam to hand the element a pre-existing iframe.

**So the serial chain today is:** parse index.html → deferred module bundle → React mount → `/api/projects` round trip → shell commit → **3.04 s layout stall** → passive mount effects → dynamic import of the player chunk → `createElement` + `appendChild` → _now_ the preview request is sent.

### What the iframe `src` depends on, and when each input is known

| Input                                                       | Source                                                                                                                                                                                           | Known at HTML-parse time?                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| project id                                                  | `location.hash` → `parseProjectIdFromHash` (`utils/projectRouting.ts:60-72`); the CLI always emits `#project/<name>` (`packages/cli/src/commands/preview.ts:1200`)                               | **Yes**                                     |
| `__hf_shader_capture_scale=1`, `__hf_shader_loading=player` | hard-coded at `Player.tsx:273-274`, appended by `shader-options.ts:88-104` (`prepareSrcForElement`) in that order                                                                                | **Yes** (constants)                         |
| `variables=`                                                | `hooks/previewVariablesStore.ts:17-19`, applied at `Player.tsx:176`. **[fact]** The only setter is the Variables panel (`components/panels/VariablesPanel.tsx:271`); nothing hydrates it at boot | **Yes** (always absent on a cold open)      |
| `directUrl` (drill-down / non-master comp)                  | `nle/useCompositionStack.ts:33,93,110`, chosen from `activeCompPath`, which is hydrated from the URL only after the **file tree** loads (`hooks/useHydrateActiveCompPathFromUrl.ts`)             | **No** — needs React state + a second fetch |
| `_t=` cache-buster                                          | `player/hooks/useTimelinePlayer.ts:457-476` (`refreshPlayer`)                                                                                                                                    | N/A (reload only)                           |
| `_hfStudioRetry`                                            | `Player.tsx:180-188`                                                                                                                                                                             | N/A (retry only)                            |
| **`t=` (playhead restore)**                                 | `utils/studioUrlState.ts:154` → applied as a **seek after load** (`hooks/useStudioUrlState.ts:272-313`), **never part of the iframe URL**                                                        | N/A                                         |

**[fact]** The exact cold-open URL is therefore fully derivable from `location.hash` alone:

```
/api/projects/<encodeURIComponent(id)>/preview?__hf_shader_capture_scale=1&__hf_shader_loading=player
```

### `refreshKey` does _not_ remount the player

**[fact]** `nle/NLEContext.tsx:113-118` — a `refreshKey` bump calls `refreshPlayer()`, which mutates `iframe.src` in place (`useTimelinePlayer.ts:457-476`). The React element is not remounted. **[inference]** Any element that exists at the right place in the DOM survives every reload path; only a `directUrl` change remounts, because `activeKey = directUrl ?? projectId` keys the `<Player>` (`NLEPreview.tsx:130,468`).

### Why fonts is a dead end (question 2)

**[fact]** Search performed, not sampled: `grep -rn "@font-face|woff|fonts.googleapis|fonts.gstatic|document.fonts|FontFace" packages/studio/src packages/studio/index.html packages/studio/public`.

- The shell's body font is a **pure system stack**: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` (`packages/studio/src/styles/studio.css:19`); mono stacks at `:293,331,426` are also local-only.
- `packages/studio/index.html` has **no** stylesheet link, no preconnect, no font at all — one favicon and one module script.
- `packages/studio/tailwind.config.js` adds no `fontFamily` override, so Tailwind preflight's `ui-sans-serif, system-ui, …` applies. No `transformIndexHtml` plugin injects anything (`packages/studio/vite.config.ts:235`, plugins are `react()` and `devProjectApi()` only).
- The only remote fonts in Studio are **on-demand and post-mount**: `components/editor/propertyPanelFont.tsx:88-108` injects a Google Fonts `<link>` when a `FontFamilyField` renders with a family (`:211`) or the user picks one (`:376`); `fontCatalog.ts:131` builds those URLs with `&display=swap` already.

**Conclusion.** There is no web font in the shell's cold path, so `font-display`, `<link rel="preload">` for fonts, and deferring the "font-dependent subtree" have nothing to act on — the subtree is _all_ text, and the trace's `<p>hi</p>` repro says a single paragraph is enough. **This plan pulls the "stop serialising behind it" lever, not the "shrink it" lever**, because the stall is Chrome's `FontFaceSet` machinery on a loaded machine and we have no input to it.

---

## Options and tradeoffs

### The constraint that decides everything

**[fact]** The preview iframe is same-origin and must stay so: Studio reads `contentDocument` everywhere — `NLEPreview.tsx:66-82` (`readPreviewCompositionSize`), `Player.tsx:79-100` (`hasUnloadedAssets`), the DOM-edit session, the timeline adapters, `previewMessageRouter.ts:99-105`.

**[inference, load-bearing]** A same-origin iframe lives in the parent's renderer process and on the parent's main thread. **The warm frame's HTML parsing, JS and layout cannot run while the parent is inside a 3.04 s synchronous task.** What _can_ overlap is everything off-thread: the HTTP request, the server's work, and subresource fetches. Hence the realistic prize is the **0.74 s** between "iframe created" and "document commits", plus the composition's asset fetches — not the composition's own script/layout time. Cross-origin (which would give true parallelism via site isolation) is off the table: it breaks every `contentDocument` reader listed above.

Say the honest bound up front: **`max(stall, network+server part of composition load) + composition main-thread part`**, not `max(stall, composition load)`.

### (a) Static `<hyperframes-player>` in `index.html`, adopted by React

Two sub-variants, both **rejected**:

- **Real adoption (React re-parents the pre-made element into the preview pane).** **[fact]** Removing and re-inserting an iframe discards its nested browsing context; the document reloads. Re-parenting throws away exactly the work we started early. Dead on arrival.
- **Never re-parent: the player lives in a fixed-position layer that tracks the preview pane's rect.** Preserves the load, but breaks: preview-only fullscreen (`PreviewPane.tsx:88-96` calls `requestFullscreen()` on the pane container — a fixed overlay outside it would not be included), the zoom/pan stage transform (`NLEPreview.tsx:190-197,437-447`), the drag-drop hit testing (`usePreviewBlockDrop`), and the overlay z-stack. Large diff, permanent complexity, for a win we can get another way.

Also **[fact]**: a `<hyperframes-player src>` in `index.html` does nothing until the custom element is _defined_ and upgraded (`hyperframes-player.ts:227` bails when `!isConnected`… and an undefined element has no callbacks at all). That means shipping the player bundle as a second head script — more startup bytes on the main thread, for a start no earlier than a plain `<iframe>`.

### (a′) Throwaway warm subframe in `index.html` — **the one that works**

A ~15-line inline script at the top of `<body>` that reads `location.hash`, and if it names a project, appends a hidden `<iframe>` to the same URL the player will use. It is never moved and never adopted; it is removed once the real preview fires `load`.

- **[inference]** Chrome's HTTP cache is keyed by `(top-frame site, frame site, url)` **plus a "subframe document resource" boolean**. A warm _subframe navigation_ shares that key with the real subframe navigation; a top-frame `fetch()` does **not**. This is why (a′) beats (b) in the browser, and why it also warms the composition's **subresources** (runtime script, the gsap CDN tags injected at `packages/studio-server/src/routes/preview.ts:45-48`, images, media) — not just the HTML.
- **[fact]** The response is `Cache-Control: private, no-cache` + `ETag` (`routes/preview.ts:310-312`), so it _is_ stored and the real navigation revalidates. **[fact]** The 304 short-circuit (`:332-339`) happens **before** any bundling or disk write, so the second request is cheap.
- **[fact]** Message safety: a phantom frame cannot corrupt state. Studio filters by sender (`previewMessageRouter.ts:57` `isForeignSource`) and the player filters by `event.source !== frameWindow` (`packages/player/src/runtime-message-handler.ts:64`).

**Failure modes.** No project in the hash → script no-ops, `useServerConnection` picks `projects[0]` (`useServerConnection.ts:47-52`) and nothing is warmed (correct: warming the wrong project is worse than not warming). `refreshKey` bump → irrelevant; `refreshPlayer` mutates `iframe.src` with a `_t` buster and never remounts (`useTimelinePlayer.ts:470-475`). Shader flags change → they are constants at `Player.tsx:273-274`; if that ever stops being true the warm URL silently misses the cache — guarded by the parity test in U3. Non-master `activeCompPath` restored from the URL → the `<Player>` remounts on the new `directUrl` key and the warm work is wasted (no breakage, no win). `?view=storyboard` (`packages/cli/src/commands/preview.ts:1183`) → `EditorShell` is only `hidden`, still mounted, so the warm still pays. HMR → the warm frame is one-shot and already gone; nothing to re-adopt.

**Costs.** The composition executes twice (memory, double media decode) unless the warm frame is `display:none` — which suppresses rAF and rendering, so it parses and fetches but does not run the animation. Concurrent cold requests can double-bundle and race `persistHfIdsIfNeeded` (`routes/preview.ts:341-344`) — a pre-existing hazard for any double request, but this makes it routine.

### (b) `<link rel="preload">` / early `fetch()`

Cheap and risk-free, but **[inference]** likely does not warm the browser cache for the subframe navigation (cache-key boolean above), and does not warm subresources at all. What it _does_ warm is the server, which (d) does better and earlier.

### (c) Mount the preview column before the font-dependent panels

**[fact]** The stall is one layout of the whole document, and passive effects run **after** layout — `Player.tsx:158` is `useMountEffect` = `useEffect` (`useMountEffect.ts:15`). Reordering React children cannot get an effect in front of the first layout. Making it work would need a static import of `@hyperframes/player` (explicitly avoided, `Player.tsx:6-8`) _plus_ `useLayoutEffect`, and would still only recover the **0.11 s** between stall-end and iframe-creation in the trace. Not worth the SSR/registration risk on its own.

**[recommendation]** Keep one crumb of it: kick the chunk fetch at module scope (U4), so the dynamic import is already resolved when the effect runs.

### (d) Prewarm the server — found in the code, and probably the biggest single win

**[fact]** The first preview request pays a **cold module load of the compiler**, on both server paths:

- Vite dev: `packages/studio/vite.adapter.ts:127-138` — `server.ssrLoadModule("@hyperframes/core/compiler")`, memoised in `_bundler` after the first call.
- CLI bundle: `packages/cli/src/server/studioServer.ts:395-402` — `await import("@hyperframes/core/compiler")`.
  Plus `transformPreviewHtml` dynamically importing `producer/services/deterministicFonts.js` (`vite.adapter.ts:249`), the project signature cache, and the media-codec probe cache (`routes/preview.ts:318`).

**[inference — the single most testable claim in this document]** Most of the measured **0.74 s** between iframe creation and document commit is that first-request server cost, not the network. If so, one `fetch()` from the CLI _before it spawns the browser_ removes it from the user's critical path entirely, with **zero** browser-side risk.

**[fact]** There is exactly one funnel for it: `openStudioBrowser` (`packages/cli/src/commands/preview.ts:1261-1273`), called from all four sites (`:546, :1399, :1624, :1646`). Warming _before_ the `noOpen` early-return also helps users who paste the URL.

---

## Recommendation and why

**Ship (d) first, measure, then ship (a′) only if the trace still shows a gap.**

1. **U1 — server prewarm.** ~5 lines in one function, no client change, no flag, no API surface. If the inference holds it deletes most of the 0.74 s for _every_ entry path including the project picker, and it does so before the browser process even exists — the most parallel possible placement.
2. **Re-trace.** If the browser's first preview request still takes > 300 ms to commit, or the composition's subresources dominate, ship **U2 (a′)**: the throwaway warm subframe. It is the only option that starts the real subframe request before React exists and warms the same cache partition the real frame will read.
3. **U4** (module-scope chunk kick) is a one-liner that shaves the remaining 0.11 s tail; take it whenever.

Rejected for this plan: (a) real adoption (re-parenting reloads the frame; the fixed-overlay variant breaks fullscreen and zoom), (b) top-frame `fetch` (weaker than both alternatives), (c) React reordering (cannot precede the first layout).

**[recommendation]** Do not chase `max(stall, composition load)` as literally stated — the same-thread constraint makes the composition's own script/layout time unrecoverable without a cross-origin frame, which the DOM-editing contract forbids. Target: **the preview document is committed before the stall ends**, so only the composition's ~0.45 s main-thread tail remains after it.

---

## Units of work

### U1 — Prewarm the preview route before the browser opens

**DoD:** After the CLI prints the Studio URL, the browser's first `GET /api/projects/<id>/preview` is served with the compiler already imported and the bundle already computed — verified by two consecutive `curl -w '%{time_total}'` calls where the _second_ is < 100 ms on the demo project, and by the first being the one that pays.
**Files:** `packages/cli/src/commands/preview.ts` (inside `openStudioBrowser`, `:1261`, before the `noOpen` return); optionally `packages/studio/vite.config.ts` (`configureServer`, `:67`) if the owner's cold-open path is the Vite dev server.
**Notes:** fire-and-forget, `.catch(() => {})`, no await, no output on failure. URL must be `/api/projects/${encodeURIComponent(projectName)}/preview` (server-side warming does not need the shader params — those do not change the bundle, only the query).

### U2 — Measure where the 0.74 s actually goes _(gate for U3)_

**DoD:** A one-run answer, written into this document, splitting the 0.74 s into server handler time vs. transfer vs. renderer dispatch — from `curl` timings against a cold server plus the `ResourceSendRequest` → `ResourceReceiveResponse` deltas already in the trace.
**Files:** none (measurement only).

### U3 — Parse-time warm subframe _(only if U2 leaves > 300 ms, or subresources dominate)_

**DoD:** On a cold load whose URL carries `#project/<id>`, the preview document request is in flight **before** the shell's first layout event starts, and the warm iframe is removed from the DOM within 1 s of the real preview's `load`.
**Files:** `packages/studio/index.html` (inline script, `display:none` iframe, `sandbox="allow-scripts allow-same-origin"` + `referrerpolicy="no-referrer"` to match `iframe-dom.ts:47-51`, opt-out on `?hfNoWarm`); `packages/studio/src/player/components/Player.tsx` (remove the warm node in `handleLoad`, `:196`); one new test.
**Test (drift guard, required):** a vitest that recomputes the expected URL from the real helpers — `prepareSrcForElement` (`shader-options.ts:139`) over an element carrying `shader-capture-scale="1"` / `shader-loading="player"` and `buildProjectApiPath(id, "/preview")` — and asserts the string embedded in `index.html` matches. If anyone changes the shader attributes, the warm URL stops matching the cache key and this test fails instead of the win silently evaporating.

### U4 — Start the player chunk fetch at module scope

**DoD:** In a cold trace, the request for the `@hyperframes/player` chunk appears before the shell's first layout, and `Player.test.ts` still passes unchanged.
**Files:** `packages/studio/src/player/components/Player.tsx:170` — hoist to a module-scope `const playerModule = typeof window === "undefined" ? null : import("@hyperframes/player")`, awaited in the effect. The `typeof window` guard preserves the SSR contract documented at `:6-8`.

---

## Verification

**[fact]** The rig already exists: `hyperframes preview --browser-path <chrome> --user-data-dir <fresh dir> --remote-debugging-port 9222` (`packages/cli/src/utils/openBrowser.ts:44-66`, validated at `packages/cli/src/commands/preview.ts:437-441`).

Procedure, per run (baseline and candidate, 5 runs each, same machine, same load, report the median and note idle vs. loaded):

1. Kill any running preview server. a **fresh** `--user-data-dir` per run; a warm profile has the preview HTML cached and hides the whole effect.
2. Start with `--no-open` so the browser launch is under the harness's control, and note the URL.
3. Throwaway node script (puppeteer-core is already a dependency of `@hyperframes/engine`): launch Chrome with the fresh profile, `page.tracing.start({ path: "<out-dir>/run-N.json", categories: ["devtools.timeline", "blink.user_timing", "disabled-by-default-devtools.timeline.frame"] })`, `page.goto(<deep link>)`, wait 15 s, `tracing.stop()`. Do not commit the script.
4. Extract four timestamps from the JSON: (i) `navigationStart` of the top frame; (ii) `ts` of the ≥ 1 s `Layout` event in the top frame (the stall) and its `dur`; (iii) `ts` of the `ResourceSendRequest` whose `args.data.url` ends in `/preview?__hf_shader_capture_scale=1&__hf_shader_loading=player`; (iv) `ts` of the `Layout` in the preview frame with ~1,602 objects.

**Pass criterion (all three):**

- **P1 — ordering:** (iii) < start of (ii). The preview request is sent before the stall begins.
- **P2 — overlap realised:** the preview frame's `commitLoad` occurs within 150 ms of the stall's end (today: ~850 ms after it).
- **P3 — user-visible:** median (iv) − (i) improves by **≥ 0.6 s** versus baseline on an idle machine, and by ≥ 0.6 s under the same synthetic load used for the 11.9 s run.

**Falsifier.** If **P1 holds but P2 and P3 do not**, the inference about what can overlap a long parent task is wrong for this case: the renderer serialised the subframe commit behind the parent anyway, the change buys nothing, and U3 must be reverted (keep U1, which is measured independently by its own `curl` DoD). If P3 improves by less than the U2-measured server cost, U1 did not land where we thought — re-open U2.

A prose argument that "it must be faster now" does not close this. Only the trace does.

---

## Invariant

> **On a cold Studio open whose URL names a project, the request for that project's preview document is already in flight before the shell's first layout task begins — the preview's load never waits on React.**

---

## Risks and rollback

| Risk                                                                                                                 | Where                                                     | Mitigation                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Double bundling / `persistHfIdsIfNeeded` write race when the warm request and the real navigation overlap while cold | `routes/preview.ts:341-344`                               | The 304 path (`:332-339`) precedes all writes, so only the _fully concurrent cold_ case doubles up. Pre-existing (any double refresh does this). Flag to the owner; do not fix here. |
| Warm URL drifts from the real URL, silently losing the cache hit                                                     | `Player.tsx:273-274` vs `index.html`                      | The U3 parity test fails loudly.                                                                                                                                                     |
| Phantom frame confuses timeline/player state                                                                         | —                                                         | **[fact]** Both listeners filter by sender: `previewMessageRouter.ts:57`, `runtime-message-handler.ts:64`.                                                                           |
| Extra memory / media decode from the warm frame                                                                      | —                                                         | `display:none` (no rAF, no rendering); removed on the real `load`.                                                                                                                   |
| Warm request for a project that then changes (`activeCompPath`, project picker)                                      | `useCompositionStack.ts:110`, `useServerConnection.ts:47` | Wasted work only; no user-visible breakage.                                                                                                                                          |
| Public web-component behaviour changes                                                                               | —                                                         | **[fact]** No unit touches `packages/player/**`.                                                                                                                                     |

**Flag & rollback.** U1: no flag; revert = delete the `void fetch(...)` line. U3: kill switch `?hfNoWarm=1` in the URL (read by the inline script itself, so it works even if the bundle is broken); revert = delete the `<script>` block from `index.html` and the removal hook in `Player.tsx`. U4: revert one line. No migrations, no persisted state, nothing to un-ship on the server.

**Existing tests that cover this ground and will need attention:**

- `packages/studio/src/player/components/Player.test.ts` — mounts the real `Player` against a fake custom element and asserts **listener-before-`src` ordering** (`:117-129`) and clean unmount when detached (`:106-115`). U3's removal hook and U4's hoisted import both run through this file.
- `packages/studio/src/components/nle/NLEPreview.test.ts` — mocks `Player`; covers `getPreviewPlayerKey` / stage sizing. Unaffected unless the mount contract changes.
- `packages/studio-server/src/routes/preview.test.ts` — the route's ETag/304 behaviour, which U1 leans on. Add a case only if the warm changes route behaviour (it should not).
- `packages/cli/src/commands/preview.test.ts` — where U1's prewarm assertion belongs (`openStudioBrowser` issues the request before spawning, and does so even under `--no-open`).

---

## Open questions for the owner

1. **Which server is on the measured path** — `hyperframes preview` (CLI bundle, `studioServer.ts:395`) or the Vite dev server (`vite.adapter.ts:129`)? U1 lands in one place or two. _No default taken._
2. **Is a phantom double-execution of the composition acceptable** (memory, duplicate media fetch, agent-observable second request in logs)? Yes → U3 as specified. No → fall back to the weaker top-frame `fetch` warm.
3. **Should the warm follow a restored non-master `activeCompPath`?** It cannot be known at parse time (needs the file-tree fetch). Master-only, or add a URL param carrying the comp path so the warm can be exact?
4. **May the shell mount before `/api/projects` answers when the hash names a project** (`App.tsx:453`, `useServerConnection.ts:26`)? That moves the whole timeline earlier but weakens the dead-server detection this gate exists for. Out of scope here; it is the next-largest structural lever.
5. **What is the target number?** "First preview frame in under X s on the reference machine under load." P3 above is a delta, not an absolute. The absolute belongs to the owner.
6. **Is the 3.04 s stall itself worth escalating to Chrome / to the machine's owner?** It reproduces on `<p>hi</p>`; everything in this plan is a workaround for someone else's bug.

---
