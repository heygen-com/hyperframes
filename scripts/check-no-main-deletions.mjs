#!/usr/bin/env node
/**
 * Fail if this branch would delete files that exist on the base.
 *
 * Written after a scare that turned out to be a measurement error, which is
 * the reason it uses the three-dot form. Comparing tip to tip (two dots) on a
 * branch that is a month behind reports every file main added since the merge
 * base as a deletion: 1,284 of them, including an entire skills tree. None of
 * that is real. A merge keeps main's side, and a pull request shows the
 * three-dot diff, which reported zero.
 *
 * So this exists to catch deletions a branch genuinely proposes, and to make
 * the distinction hard to get wrong again. If it ever disagrees with a manual
 * git diff, check which form the manual one used before believing it.
 *
 * Renames are reported separately. In a name-only diff a rename is
 * indistinguishable from a deletion, so treating them alike would either mask
 * real loss or block every legitimate move.
 *
 *   node scripts/check-no-main-deletions.mjs [--base origin/main]
 */

import { execFileSync } from "node:child_process";

const BASE_FLAG = "--base";

/**
 * Deletions this repository has already agreed to, each with the reason.
 *
 * A blanket escape hatch (a flag, an env var, `--force`) would turn the guard
 * off exactly when it matters, because the branch deleting something by
 * accident is also the branch that would reach for it. Naming each path here
 * instead keeps the default absolute and makes every intentional removal a
 * reviewable line in a diff.
 *
 * Entries are for deletions that are NOT renames — git already pairs those on
 * its own. Remove an entry once its deletion has landed on the base.
 */
const STORYBOARD_VIEW_REASON =
  "owner-directed removal of the Studio storyboard view; its only readers were deleted with it";

export const ALLOWED_DELETIONS = new Map([
  [
    "packages/studio/src/utils/editHistoryStorage.ts",
    "Studio's undo moves onto the project history (studio-server); the browser IndexedDB history and its reducer are removed",
  ],
  [
    "packages/studio/src/utils/editHistoryStorage.test.ts",
    "tests for the removed IndexedDB history store",
  ],
  [
    "packages/studio/src/utils/editHistory.test.ts",
    "tests for the removed in-browser history reducer; merging and undo are tested in projectHistory.test.ts",
  ],
  [
    "packages/studio/src/hooks/usePersistentEditHistory.projectOwnership.test.tsx",
    "tests the removed per-project IndexedDB store; the hook now posts to the project's own history routes",
  ],
  [
    "packages/studio/src/components/nle/TimelinePane.test.ts",
    "its only subject, the expandedParentStart rebase wrappers, is dead code now removed",
  ],
  [
    "scripts/test-reachability-baseline.json",
    "Reachability now requires zero orphans and rejects baseline files.",
  ],
  [
    "packages/studio/src/player/hooks/useTimelineRowElements.ts",
    "D-834 removes the duplicate row-source hook; manifest elements are now the single timeline row owner",
  ],
  [
    "packages/studio/src/player/hooks/useTimelineRowElements.test.ts",
    "D-834 removes tests for the deleted duplicate row-source hook",
  ],
  [
    "packages/studio/src/components/StudioGlobalDragOverlay.tsx",
    "the full-screen drop-to-add box is replaced by a landing preview on the timeline; no remaining references",
  ],
  [
    "packages/studio/src/components/PanelTabButton.tsx",
    "replaced by the shared Tabs primitive in RightPanelTabs; no remaining references",
  ],
  [
    "packages/studio/postcss.config.js",
    "Tailwind v4 migration: postcss replaced by @tailwindcss/vite",
  ],
  [
    "packages/studio/tailwind.config.js",
    "Tailwind v4 migration: config moves into styles/studio.css via @theme",
  ],
  [
    "docs/snippets/catalog-overview-player.jsx",
    "#4051 removes the Catalog overview's only consumer of this snippet (replaced by the browse-grid mount); confirmed unreferenced repo-wide before deleting",
  ],
  [
    "packages/studio/src/hooks/useSdkSession.test.ts",
    "tests only shouldReloadSdkSession, a function with no production callers removed with the preview reload fix",
  ],
  [
    "docs/catalog/components/ai-generation-canvas.mdx",
    "owner-directed removal of the AI Generation Canvas catalog item and its generated documentation",
  ],
  [
    "docs/catalog/components/ai-prompt-flow.mdx",
    "owner-directed removal of the AI Prompt Flow catalog item and its generated documentation",
  ],
  [
    "docs/catalog/components/checkout-flow.mdx",
    "owner-directed removal of the Checkout Flow catalog item and its generated documentation",
  ],
  [
    "docs/public/catalog/components/ai-generation-canvas.json",
    "owner-directed removal of the AI Generation Canvas catalog item and its generated public payload",
  ],
  [
    "docs/public/catalog/components/ai-prompt-flow.json",
    "owner-directed removal of the AI Prompt Flow catalog item and its generated public payload",
  ],
  [
    "docs/public/catalog/components/checkout-flow.json",
    "owner-directed removal of the Checkout Flow catalog item and its generated public payload",
  ],
  [
    "registry/components/ai-generation-canvas/ai-generation-canvas.html",
    "owner-directed removal of the AI Generation Canvas catalog source component",
  ],
  [
    "registry/components/ai-generation-canvas/demo.html",
    "owner-directed removal of the AI Generation Canvas catalog preview source",
  ],
  [
    "registry/components/ai-generation-canvas/registry-item.json",
    "owner-directed removal of the AI Generation Canvas catalog registry entry",
  ],
  [
    "registry/components/ai-prompt-flow/ai-prompt-flow.html",
    "owner-directed removal of the AI Prompt Flow catalog source component",
  ],
  [
    "registry/components/ai-prompt-flow/demo.html",
    "owner-directed removal of the AI Prompt Flow catalog preview source",
  ],
  [
    "registry/components/ai-prompt-flow/registry-item.json",
    "owner-directed removal of the AI Prompt Flow catalog registry entry",
  ],
  [
    "registry/components/checkout-flow/checkout-flow.html",
    "owner-directed removal of the Checkout Flow catalog source component",
  ],
  [
    "registry/components/checkout-flow/demo.html",
    "owner-directed removal of the Checkout Flow catalog preview source",
  ],
  [
    "registry/components/checkout-flow/registry-item.json",
    "owner-directed removal of the Checkout Flow catalog registry entry",
  ],
  [
    "packages/studio/src/components/StudioFeedbackBar.tsx",
    "replaced by components/feedback/StudioFeedbackCard.tsx; too little shared content for git to pair as a rename",
  ],
  [
    "skills/embedded-captions/references/test-set.md",
    "#3219: orphaned in the shipped skill (zero inbound references across all 140 files) and its corpus lives only at ~/Downloads/heygen_relevant_videos/, so it was neither reachable nor runnable on any install",
  ],
  [
    "skills/embedded-captions/themes/PORTING.md",
    "#3219: same, zero inbound references; a theme-authoring procedure whose inputs (cap_fx3 demos, frame corpora, CONTRACT.md) are not distributed with the skill",
  ],
  [
    "packages/core/scripts/build-audio-fx-runtime.ts",
    "merged into build-inline-artifact.ts: this and build-position-edits-render.ts were a byte-for-byte clone differing only in five names, which fallow's duplication check kept re-flagging on every unrelated line shift",
  ],
  [
    "packages/core/scripts/build-position-edits-render.ts",
    "merged into build-inline-artifact.ts, same reason as build-audio-fx-runtime.ts above",
  ],
  [
    "packages/core/scripts/build-inline-artifact.ts",
    "a later branch in this stack (wa-20b2-lfo-fixes) independently deduped the same two build scripts a different way — buildInjectedArtifact.ts plus two thin per-target files — before this consolidation and that one had merged; this branch's tree keeps that shape instead, so build-inline-artifact.ts is the one that goes.",
  ],
  [
    "packages/studio/src/hooks/useAudioSoloBridge.ts",
    "#3453 removes the obsolete solo bridge after its last consumer leaves",
  ],
  [
    "packages/studio/src/hooks/useGroupLevel.ts",
    "#3454 deliberately removes the group level meter with the group volume strip",
  ],
  [
    "packages/studio/src/player/components/TimelineGroupBusStrip.test.tsx",
    "#3454 deliberately removes the group volume and level-meter strip and its tests",
  ],
  [
    "packages/studio/src/player/components/TimelineGroupBusStrip.tsx",
    "#3454 deliberately removes the group volume and level-meter strip",
  ],
  [
    "packages/studio/src/player/components/TimelineSoloButton.tsx",
    "#3454 deliberately removes track and group solo controls",
  ],
  [
    "packages/studio/src/player/store/audioSoloSlice.test.ts",
    "#3454 deliberately removes session solo state and its tests",
  ],
  [
    "packages/studio/src/player/store/audioSoloSlice.ts",
    "#3454 deliberately removes session solo state",
  ],
  [
    "packages/studio/src/player/store/groupLevels.ts",
    "#3454 deliberately removes group level-meter state",
  ],
  [
    "docs/public/catalog/components/texture-mask-text.json",
    "the item's directory exceeds the host budget and now falls back to its recorded video; the stale payload had no <base href> and dead relative asset references, so removing it is the fix, not the regression",
  ],
  [
    "packages/studio/src/player/hooks/useExpandedTimelineElements.ts",
    "the timeline shows top-level rows only, so the child-row expansion hook is replaced by useTimelineRowElements",
  ],
  [
    "packages/studio/src/player/hooks/useExpandedTimelineElements.test.ts",
    "tests for the removed child-row expansion hook",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/av_r1k1.mp4",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/av_r1k3.mp4",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/av_r1k4.mp4",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/av_r2k0.mp4",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/av_r2k2.mp4",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/bgm.m4a",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/fonts/eb-garamond-latin-400-normal.woff2",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/fonts/eb-garamond-latin-700-normal.woff2",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/fonts/inter-latin-400-normal.woff2",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/fonts/inter-latin-500-normal.woff2",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/fonts/inter-latin-600-normal.woff2",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "docs/public/catalog/assets/0743c9b7b918b0d9.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/0ad78008621fe77d.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/1d083f9292fdd0f8.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/202dcdfded4c9ff5.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/44b382d4775c2bb8.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/5a88ad5abfd02f99.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/61facab3428ae59c.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/6fef5557664470a3.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/7254a2cfd76b60b5.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/bd3c8b0cb5fa618c.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/d0ff80e331a5ebdb.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/df3dc3536491ffca.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/e234267390ffd6ff.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "packages/studio/src/components/StudioLeftSidebar.tsx",
    "replaced by StudioLeftPanels.tsx, which mounts the left-zone panels as dock panels instead of a fixed sidebar",
  ],
  [
    "packages/studio/src/components/sidebar/LeftSidebar.tsx",
    "replaced by the dock-mounted CompositionsPanel/StudioLeftPanels; sidebar tab-switching is now the dock's own tab strip",
  ],
  [
    "packages/studio/src/components/sidebar/LeftSidebar.storage.test.ts",
    "tested the fixed-sidebar tab persistence removed with LeftSidebar.tsx; the dock persists its own layout",
  ],
  [
    "packages/studio/src/components/nle/TimelineResizeDivider.tsx",
    "the timeline's own resize divider; panel sizing is now the dock's sash",
  ],
  [
    "packages/studio/src/hooks/useInspectorSplitResize.ts",
    "resized the old fixed Layers/Design split pane, removed with the split-inspector layout",
  ],
  [
    "packages/studio/src/utils/fitPanels.ts",
    "computed fixed left/right panel widths for the old EditorShell layout; the dock sizes its own panels",
  ],
  ["packages/studio/src/utils/fitPanels.test.ts", "tests for fitPanels.ts, removed with it"],
  ...[
    "docs/studio/storyboard.mdx",
    "packages/studio-server/src/routes/storyboard.test.ts",
    "packages/studio-server/src/routes/storyboard.ts",
    "packages/studio/fixtures/storyboard-sample/README.md",
    "packages/studio/fixtures/storyboard-sample/SCRIPT.md",
    "packages/studio/fixtures/storyboard-sample/STORYBOARD.md",
    "packages/studio/fixtures/storyboard-sample/compositions/frames/01-hook.html",
    "packages/studio/fixtures/storyboard-sample/compositions/frames/02-problem.html",
    "packages/studio/fixtures/storyboard-sample/compositions/frames/03-feature.html",
    "packages/studio/fixtures/storyboard-sample/compositions/frames/04-proof.html",
    "packages/studio/fixtures/storyboard-sample/index.html",
    "packages/studio/src/components/storyboard/AgentChatMessageButton.test.tsx",
    "packages/studio/src/components/storyboard/AgentChatMessageButton.tsx",
    "packages/studio/src/components/storyboard/FramePoster.test.tsx",
    "packages/studio/src/components/storyboard/FramePoster.tsx",
    "packages/studio/src/components/storyboard/StoryboardDirection.tsx",
    "packages/studio/src/components/storyboard/StoryboardFrameFocus.tsx",
    "packages/studio/src/components/storyboard/StoryboardFrameTile.tsx",
    "packages/studio/src/components/storyboard/StoryboardGrid.tsx",
    "packages/studio/src/components/storyboard/StoryboardLoaded.tsx",
    "packages/studio/src/components/storyboard/StoryboardReviewGuide.tsx",
    "packages/studio/src/components/storyboard/StoryboardScriptPanel.tsx",
    "packages/studio/src/components/storyboard/StoryboardSourceEditor.tsx",
    "packages/studio/src/components/storyboard/StoryboardStatusLegend.tsx",
    "packages/studio/src/components/storyboard/StoryboardView.tsx",
    "packages/studio/src/components/storyboard/StoryboardViewModeGuard.test.tsx",
    "packages/studio/src/components/storyboard/frameComments.test.ts",
    "packages/studio/src/components/storyboard/frameComments.ts",
    "packages/studio/src/components/storyboard/frameStatus.ts",
    "packages/studio/src/components/storyboard/storyboardReviewStage.test.ts",
    "packages/studio/src/components/storyboard/storyboardReviewStage.ts",
    "packages/studio/src/components/storyboard/useFrameComments.ts",
    "packages/studio/src/contexts/ViewModeContext.tsx",
    "packages/studio/src/hooks/useProjectSignaturePoll.test.tsx",
    "packages/studio/src/hooks/useProjectSignaturePoll.ts",
    "packages/studio/src/hooks/useStoryboard.ts",
  ].map((path) => [path, STORYBOARD_VIEW_REASON]),
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-basic.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-clear-dark.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-clear-light.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-grass.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-homebrew.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-man-page.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-novel.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-ocean.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-red-sands.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-silver-aerogel.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-solid-colors.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-dark-plus.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-flight.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-high-contrast-light.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-high-contrast.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-light-2026.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-light-modern.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-light-plus.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-monokai.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-solarized-light.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-visual-studio-dark.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-visual-studio-light.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/liquid-glass-context-menu.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/liquid-glass-media-controls.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-basic.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-clear-dark.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-clear-light.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-grass.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-homebrew.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-man-page.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-novel.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-ocean.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-red-sands.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-silver-aerogel.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-solid-colors.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-dark-plus.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-flight.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-high-contrast-light.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-high-contrast.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-light-2026.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-light-modern.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-light-plus.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-monokai.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-solarized-light.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-visual-studio-dark.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-visual-studio-light.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/liquid-glass-context-menu.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/liquid-glass-media-controls.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-dark-plus/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-dark-plus/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-high-contrast-light/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-high-contrast-light/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-high-contrast/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-high-contrast/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-light-2026/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-light-2026/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-light-modern/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-light-modern/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-light-plus/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-light-plus/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-monokai/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-monokai/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-solarized-light/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-solarized-light/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-visual-studio-dark/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-visual-studio-dark/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-visual-studio-light/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-visual-studio-light/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-basic/code-snippet-apple-terminal-basic.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-basic/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-clear-dark/code-snippet-apple-terminal-clear-dark.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-clear-dark/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-clear-light/code-snippet-apple-terminal-clear-light.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-clear-light/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-grass/code-snippet-apple-terminal-grass.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-grass/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-homebrew/code-snippet-apple-terminal-homebrew.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-homebrew/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-man-page/code-snippet-apple-terminal-man-page.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-man-page/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-novel/code-snippet-apple-terminal-novel.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-novel/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-ocean/code-snippet-apple-terminal-ocean.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-ocean/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-red-sands/code-snippet-apple-terminal-red-sands.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-red-sands/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-silver-aerogel/code-snippet-apple-terminal-silver-aerogel.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-silver-aerogel/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-solid-colors/code-snippet-apple-terminal-solid-colors.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-solid-colors/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-dark-plus/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-dark-plus/code-snippet-dark-plus.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-dark-plus/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-flight/code-snippet-flight.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-flight/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-high-contrast-light/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-high-contrast-light/code-snippet-high-contrast-light.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-high-contrast-light/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-high-contrast/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-high-contrast/code-snippet-high-contrast.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-high-contrast/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-2026/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-2026/code-snippet-light-2026.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-2026/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-modern/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-modern/code-snippet-light-modern.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-modern/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-plus/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-plus/code-snippet-light-plus.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-plus/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-monokai/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-monokai/code-snippet-monokai.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-monokai/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-solarized-light/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-solarized-light/code-snippet-solarized-light.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-solarized-light/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-visual-studio-dark/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-visual-studio-dark/code-snippet-visual-studio-dark.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-visual-studio-dark/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-visual-studio-light/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-visual-studio-light/code-snippet-visual-studio-light.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-visual-studio-light/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/liquid-glass-context-menu/lib/liquid-glass.iife.js",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/liquid-glass-context-menu/liquid-glass-context-menu.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/liquid-glass-context-menu/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/liquid-glass-media-controls/lib/liquid-glass.iife.js",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/liquid-glass-media-controls/liquid-glass-media-controls.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/liquid-glass-media-controls/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/airbnb-deck/DESIGN.md",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/airbnb-deck/index.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/airbnb-deck/sfx/advance.mp3",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/airbnb-deck/sfx/back.mp3",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/airbnb-deck/sfx/branch-enter.mp3",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/airbnb-deck/sfx/fragment.mp3",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/motion-blur/index.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/slideshow-demo/index.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/startup-pitch/demo.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/startup-pitch/index.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/DESIGN.md",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-sequence-runtime.js",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-sequence.css",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-theme-registry.js",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/2026-dark.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/2026-light.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/LICENSE",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/dark_modern.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/dark_plus.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/dark_vs.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/hc_black.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/hc_light.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/light_modern.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/light_plus.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/light_vs.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/monokai-color-theme.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/solarized-light-color-theme.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/index.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/dark-2026.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/dark-modern.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/dark-plus.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/high-contrast-light.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/high-contrast.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/light-2026.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/light-modern.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/light-plus.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/monokai.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/solarized-light.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/visual-studio-dark.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/visual-studio-light.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/scripts/build-compositions.mjs",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/scripts/build-theme-registry.mjs",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
]);

export function parseBase(argv, fallback = "origin/main") {
  const index = argv.indexOf(BASE_FLAG);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${BASE_FLAG} needs a ref, for example ${BASE_FLAG} origin/main`);
  }
  return value;
}

/**
 * Split a `--name-status` diff into deletions and renames.
 *
 * Git reports a rename as `R<score>\told\tnew`. Reading only the first column
 * would file that under "deleted", which is the false alarm this guards
 * against being noisy enough to ignore.
 */
// one branch per git status code
// fallow-ignore-next-line complexity
export function classify(nameStatus) {
  const deleted = [];
  const renamed = [];
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const [status, ...paths] = line.split("\t");
    if (status.startsWith("R")) renamed.push({ from: paths[0], to: paths[1] });
    else if (status === "D") deleted.push(paths[0]);
  }
  return { deleted, renamed };
}

// a script entry point
// fallow-ignore-next-line complexity
function main() {
  const base = parseBase(process.argv.slice(2));
  let diff;
  try {
    diff = execFileSync("git", ["diff", "--name-status", "-M", `${base}...HEAD`], {
      encoding: "utf8",
    });
  } catch (error) {
    // An unreachable base is not a pass. Reporting "no deletions" because the
    // ref was misspelled is the exact failure this exists to prevent.
    console.error(`cannot diff against ${base}: ${error.message.trim()}`);
    process.exit(2);
  }

  const { deleted: allDeleted, renamed } = classify(diff);
  const agreed = allDeleted.filter((path) => ALLOWED_DELETIONS.has(path));
  const deleted = allDeleted.filter((path) => !ALLOWED_DELETIONS.has(path));

  if (agreed.length > 0) {
    console.log(`${agreed.length} deletion(s) agreed in ALLOWED_DELETIONS:`);
    for (const path of agreed) console.log(`  ${path} — ${ALLOWED_DELETIONS.get(path)}`);
  }
  if (renamed.length > 0) {
    console.log(`${renamed.length} renamed (allowed):`);
    for (const { from, to } of renamed.slice(0, 10)) console.log(`  ${from} -> ${to}`);
    if (renamed.length > 10) console.log(`  … and ${renamed.length - 10} more`);
  }

  if (deleted.length === 0) {
    console.log(`No files from ${base} are deleted by this branch.`);
    return;
  }

  console.error(`This branch deletes ${deleted.length} files that exist on ${base}:`);
  for (const path of deleted.slice(0, 25)) console.error(`  ${path}`);
  if (deleted.length > 25) console.error(`  … and ${deleted.length - 25} more`);
  console.error("\nIf a deletion is intended, remove this check for that path deliberately.");
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
