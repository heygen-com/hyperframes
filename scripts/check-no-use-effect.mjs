#!/usr/bin/env node

// Studio bans bare `useEffect` (root `CLAUDE.md`, "React Rules"), and `useLayoutEffect` with it:
// same coupling hidden in a dependency array, same loops and races, and it blocks paint as well.
// Prose alone never failed a build, so the call sites kept accumulating while the rule read as
// absolute. This gate makes the rule mechanical without demanding a repo-wide refactor first.
//
// oxlint has no `useEffect` ban, and the two shapes that could stand in for one both fail the
// requirement that matters here:
//
//   - A rule scoped to skip the directories holding the violations is a silent allowance. Nobody
//     can count what is exempt, and the exemption never shrinks.
//   - Per-file `oxlint-disable` comments are visible but do not ratchet: a file that is already
//     suppressed can grow from 4 effects to 40 and stay green.
//
// So the exemption is a COUNT per file, listed in BUDGET below. A new file with an effect fails.
// A listed file that grows fails. A listed file that shrinks ALSO fails, asking for the number to
// come down -- that is what makes the list a debt register that can only be paid off, and what
// lets a reader watch the total move. When every count reaches zero, delete BUDGET and this
// script becomes a flat ban.
//
// Counting runs on the TypeScript AST rather than grep, because docblocks quote the banned
// pattern while explaining it and prose about a rule must not be counted as breaking it. Aliasing
// is resolved rather than assumed away: `import { useEffect as x }`, `React.useEffect` and a
// namespace import all resolve to the same call and all count. Both banned hooks share one
// budget, so neither can be smuggled in by spelling it the other way.

import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const SCANNED = "packages/studio/src";

/**
 * The banned hooks. `useLayoutEffect` carries the same hazard as `useEffect` and blocks paint on
 * top, so it is banned on the same terms. Swapping one for the other is not new debt, so the
 * register tracks their total per file rather than one number each.
 */
const BANNED = new Set(["useEffect", "useLayoutEffect"]);

/**
 * The sanctioned escape hatch: the one file allowed to call `useEffect`, because it is what every
 * other call site is meant to use instead. Not in BUDGET, because BUDGET must be able to reach
 * zero and this entry never will.
 */
const SANCTIONED = new Map([
  [
    "packages/studio/src/hooks/useMountEffect.ts",
    "defines useMountEffect(), the sanctioned wrapper the ban points at",
  ],
]);

/**
 * Pre-existing call sites, by file, counted at the commit that added this gate. These are debt,
 * not permission. Lower a number when you remove an effect, delete the entry when it hits zero,
 * and never raise one.
 */
const BUDGET = new Map([
  ["packages/studio/src/App.tsx", 1],
  ["packages/studio/src/captions/components/shared.tsx", 1],
  ["packages/studio/src/components/TimelineToolbar.tsx", 1],
  ["packages/studio/src/components/editor/AnimationCard.tsx", 2],
  ["packages/studio/src/components/editor/BlockParamsPanel.tsx", 1],
  ["packages/studio/src/components/editor/DomEditCropHandles.tsx", 1],
  ["packages/studio/src/components/editor/DomEditOverlay.tsx", 1],
  ["packages/studio/src/components/editor/EaseCurveSection.tsx", 3],
  ["packages/studio/src/components/editor/EaseParamFields.tsx", 2],
  ["packages/studio/src/components/editor/FileTreeNodes.tsx", 3],
  ["packages/studio/src/components/editor/InlineTextToolbar.tsx", 1],
  ["packages/studio/src/components/editor/LayersPanel.tsx", 4],
  ["packages/studio/src/components/editor/MotionPathOverlay.tsx", 4],
  ["packages/studio/src/components/editor/PromotableControl.tsx", 1],
  ["packages/studio/src/components/editor/PropertyPanelFlat.tsx", 1],
  ["packages/studio/src/components/editor/SnapToolbar.tsx", 2],
  ["packages/studio/src/components/editor/SourceEditor.tsx", 2],
  ["packages/studio/src/components/editor/TimelineFxPopover.tsx", 1],
  ["packages/studio/src/components/editor/TopologyLens.tsx", 5],
  ["packages/studio/src/components/editor/Transform3DCube.tsx", 1],
  ["packages/studio/src/components/editor/propertyPanelColor.tsx", 3],
  ["packages/studio/src/components/editor/propertyPanelColorGradingSlider.tsx", 1],
  ["packages/studio/src/components/editor/propertyPanelColorScopes.tsx", 1],
  ["packages/studio/src/components/editor/propertyPanelColorSecondary.tsx", 1],
  ["packages/studio/src/components/editor/propertyPanelCommitField.tsx", 2],
  ["packages/studio/src/components/editor/propertyPanelFlatColorGradingAccessory.tsx", 1],
  ["packages/studio/src/components/editor/propertyPanelFlatColorGradingSection.tsx", 2],
  ["packages/studio/src/components/editor/propertyPanelFlatEffectsSection.tsx", 2],
  ["packages/studio/src/components/editor/propertyPanelFlatMediaSection.tsx", 1],
  ["packages/studio/src/components/editor/propertyPanelFlatPrimitives.tsx", 2],
  ["packages/studio/src/components/editor/propertyPanelFlatStyleSections.tsx", 1],
  ["packages/studio/src/components/editor/propertyPanelFlatTextSection.tsx", 1],
  ["packages/studio/src/components/editor/propertyPanelFont.tsx", 5],
  ["packages/studio/src/components/editor/propertyPanelFxControls.tsx", 2],
  ["packages/studio/src/components/editor/propertyPanelFxEqModule.tsx", 1],
  ["packages/studio/src/components/editor/propertyPanelFxSection.tsx", 1],
  ["packages/studio/src/components/editor/propertyPanelGradingNumberField.tsx", 1],
  ["packages/studio/src/components/editor/propertyPanelMediaSection.tsx", 1],
  ["packages/studio/src/components/editor/propertyPanelPrimitives.tsx", 2],
  ["packages/studio/src/components/editor/propertyPanelSections.tsx", 4],
  ["packages/studio/src/components/editor/propertyPanelStyleSections.tsx", 2],
  ["packages/studio/src/components/editor/useAudioFxRevealSection.ts", 1],
  ["packages/studio/src/components/editor/useCanvasContextMenuState.ts", 1],
  ["packages/studio/src/components/editor/useColorGradingController.ts", 7],
  ["packages/studio/src/components/editor/useColorGradingPreviews.ts", 2],
  ["packages/studio/src/components/editor/useColorGradingScopes.ts", 1],
  ["packages/studio/src/components/editor/useDomEditNudge.ts", 2],
  ["packages/studio/src/components/editor/useFxAudition.ts", 1],
  ["packages/studio/src/components/editor/useFxCarve.ts", 3],
  ["packages/studio/src/components/editor/useFxChainObserved.ts", 1],
  ["packages/studio/src/components/editor/useInspectorGestureTransaction.ts", 2],
  ["packages/studio/src/components/editor/useLayerRevealOverride.ts", 2],
  ["packages/studio/src/components/editor/useMotionPathData.ts", 2],
  ["packages/studio/src/components/editor/useZOrderCrossedFlash.tsx", 1],
  ["packages/studio/src/components/feedback/CrashFeedbackPrompt.tsx", 1],
  ["packages/studio/src/components/feedback/StudioFeedbackCard.tsx", 3],
  ["packages/studio/src/components/nle/AssetPreviewOverlay.tsx", 2],
  ["packages/studio/src/components/nle/NLEContext.tsx", 7],
  ["packages/studio/src/components/nle/NLEPreview.test.ts", 1],
  ["packages/studio/src/components/nle/NLEPreview.tsx", 6],
  ["packages/studio/src/components/nle/useCompositionStack.ts", 1],
  ["packages/studio/src/components/panels/SlideshowPanel.tsx", 2],
  ["packages/studio/src/components/panels/VariablesPanel.tsx", 1],
  ["packages/studio/src/components/renders/FfmpegRequiredNotice.tsx", 3],
  ["packages/studio/src/components/renders/RenderQueue.tsx", 4],
  ["packages/studio/src/components/renders/useFfmpegStatus.ts", 2],
  ["packages/studio/src/components/renders/useRenderQueue.ts", 3],
  ["packages/studio/src/components/sidebar/AssetCard.tsx", 1],
  ["packages/studio/src/components/sidebar/AssetContextMenu.tsx", 3],
  ["packages/studio/src/components/sidebar/AssetsTab.tsx", 1],
  ["packages/studio/src/components/sidebar/AudioRow.tsx", 2],
  ["packages/studio/src/components/sidebar/BlocksTab.tsx", 1],
  ["packages/studio/src/components/sidebar/CompositionsTab.tsx", 2],
  ["packages/studio/src/components/sidebar/GlobalAssetsView.tsx", 1],
  ["packages/studio/src/components/sidebar/PromptPreviewModal.tsx", 1],
  ["packages/studio/src/components/storyboard/AgentChatMessageButton.tsx", 1],
  ["packages/studio/src/components/storyboard/FramePoster.tsx", 1],
  ["packages/studio/src/components/storyboard/StoryboardFrameFocus.tsx", 3],
  ["packages/studio/src/components/storyboard/StoryboardLoaded.tsx", 2],
  ["packages/studio/src/components/storyboard/StoryboardSourceEditor.tsx", 4],
  ["packages/studio/src/components/storyboard/useFrameComments.ts", 1],
  ["packages/studio/src/components/ui/Tooltip.tsx", 2],
  ["packages/studio/src/components/ui/VideoFrameThumbnail.tsx", 1],
  ["packages/studio/src/components/ui/useDialogBehavior.ts", 1],
  ["packages/studio/src/contexts/VariablePromoteContext.tsx", 1],
  ["packages/studio/src/contexts/ViewModeContext.tsx", 1],
  ["packages/studio/src/hooks/useAppHotkeys.ts", 2],
  ["packages/studio/src/hooks/useAskAgentModal.ts", 2],
  ["packages/studio/src/hooks/useAutomationSelectionKeyboard.ts", 1],
  ["packages/studio/src/hooks/useBlockCatalog.ts", 1],
  ["packages/studio/src/hooks/useCaptionDetection.ts", 3],
  ["packages/studio/src/hooks/useConsoleErrorCapture.ts", 1],
  ["packages/studio/src/hooks/useContextMenuDismiss.ts", 1],
  ["packages/studio/src/hooks/useDomEditPreviewSync.ts", 2],
  ["packages/studio/src/hooks/useDomEditWiring.ts", 2],
  ["packages/studio/src/hooks/useDomSelection.ts", 5],
  ["packages/studio/src/hooks/useExternalFileChangeCoordinator.ts", 4],
  ["packages/studio/src/hooks/useFileTree.ts", 1],
  ["packages/studio/src/hooks/useGestureCommit.ts", 1],
  ["packages/studio/src/hooks/useGestureRecording.ts", 1],
  ["packages/studio/src/hooks/useGsapPropertyDebounce.ts", 1],
  ["packages/studio/src/hooks/useGsapTweenCache.ts", 4],
  ["packages/studio/src/hooks/useHydrateActiveCompPathFromUrl.ts", 1],
  ["packages/studio/src/hooks/useInlineTextEdit.ts", 2],
  ["packages/studio/src/hooks/useKeyframeKeyboard.ts", 1],
  ["packages/studio/src/hooks/useLintModal.ts", 3],
  ["packages/studio/src/hooks/useLivePlayheadTime.ts", 1],
  ["packages/studio/src/hooks/useMusicBeatAnalysis.ts", 2],
  ["packages/studio/src/hooks/usePanelLayout.ts", 1],
  ["packages/studio/src/hooks/usePersistentEditHistory.ts", 1],
  ["packages/studio/src/hooks/usePreviewDocumentVersion.ts", 1],
  ["packages/studio/src/hooks/useProjectCompositionVariables.ts", 1],
  ["packages/studio/src/hooks/useProjectSignaturePoll.ts", 1],
  ["packages/studio/src/hooks/useRemoveBackground.ts", 1],
  ["packages/studio/src/hooks/useSdkSelectionSync.ts", 1],
  ["packages/studio/src/hooks/useSdkSession.ts", 2],
  ["packages/studio/src/hooks/useServerConnection.ts", 1],
  ["packages/studio/src/hooks/useSlideshowTabState.ts", 1],
  ["packages/studio/src/hooks/useStoryboard.ts", 1],
  ["packages/studio/src/hooks/useStudioSdkSessions.ts", 1],
  ["packages/studio/src/hooks/useStudioSelectionPublisher.ts", 4],
  ["packages/studio/src/hooks/useStudioSessionStart.ts", 1],
  ["packages/studio/src/hooks/useStudioTestHooks.ts", 1],
  ["packages/studio/src/hooks/useStudioUrlState.ts", 6],
  ["packages/studio/src/hooks/useThumbnailLease.ts", 1],
  ["packages/studio/src/hooks/useTimelineSelectionPreviewSync.ts", 1],
  ["packages/studio/src/player/components/Player.tsx", 4],
  ["packages/studio/src/player/components/PlayerControls.tsx", 2],
  ["packages/studio/src/player/components/ShortcutsPanel.tsx", 1],
  ["packages/studio/src/player/components/TimelineAutomationLane.tsx", 2],
  ["packages/studio/src/player/components/TimelineAutomationLaneSlot.tsx", 1],
  ["packages/studio/src/player/components/TimelineClipDiamonds.tsx", 1],
  ["packages/studio/src/player/components/TimelineFxButton.tsx", 1],
  ["packages/studio/src/player/components/TimelineOverlays.tsx", 2],
  ["packages/studio/src/player/components/menuKeyboardNav.ts", 1],
  ["packages/studio/src/player/components/timelineDragDrop.ts", 2],
  ["packages/studio/src/player/components/useAutoExpandKeyframedClips.ts", 1],
  ["packages/studio/src/player/components/useTimelineActiveClips.ts", 1],
  ["packages/studio/src/player/components/useTimelineClipDrag.ts", 1],
  ["packages/studio/src/player/components/useTimelineFocusCoordinator.ts", 2],
  ["packages/studio/src/player/components/useTimelineGeometry.ts", 2],
  ["packages/studio/src/player/components/useTimelinePlayhead.ts", 5],
  ["packages/studio/src/player/components/useTimelineRangeSelection.ts", 3],
  ["packages/studio/src/player/components/useTimelineRowVirtualization.ts", 1],
  ["packages/studio/src/player/components/useTimelineScrollViewport.ts", 1],
  ["packages/studio/src/player/components/useTimelineSelectionLifecycle.ts", 1],
  ["packages/studio/src/player/components/useTimelineVirtualRows.ts", 2],
  ["packages/studio/src/player/components/useTrackGapMenu.ts", 1],
  ["packages/studio/src/player/hooks/useExpandedTimelineElements.test.ts", 1],
  ["packages/studio/src/player/hooks/usePlaybackKeyboard.test.ts", 1],
  ["packages/studio/src/player/hooks/useTimelinePlayer.seek.test.ts", 1],
  ["packages/studio/src/player/hooks/useTimelinePlayer.ts", 2],
  ["packages/studio/src/webmcp/StudioAgentTools.tsx", 1],
  ["packages/studio/src/webmcp/useStudioAgentTools.ts", 1],
]);

/** Studio source the ban applies to: TypeScript, minus the ambient declarations. */
function isScannedSource(name) {
  return /\.tsx?$/.test(name) && !name.endsWith(".d.ts");
}

/** Every file under SCANNED the ban applies to, repo-relative and sorted. */
export function sources() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (isScannedSource(entry.name)) found.push(path);
    }
  };
  walk(SCANNED);
  return found.sort();
}

/**
 * The import clause of `import ... from "react"`, or undefined for any other statement. A hook
 * imported from anywhere else is a different function that merely shares a name, so the module
 * specifier has to match before any name in the clause means anything.
 */
function reactImportClause(statement) {
  if (!ts.isImportDeclaration(statement)) return undefined;
  if (!ts.isStringLiteral(statement.moduleSpecifier)) return undefined;
  if (statement.moduleSpecifier.text !== "react") return undefined;
  return statement.importClause;
}

/** The local name of `import * as React from "react"`, if the clause has one. */
function namespaceImportName(named) {
  return named && ts.isNamespaceImport(named) ? named.name.text : undefined;
}

/** Names standing for the whole React namespace: the default import and the star import. */
function namespaceNames(clause) {
  return [clause.name?.text, namespaceImportName(clause.namedBindings)].filter(
    (name) => name !== undefined,
  );
}

/** Local names a `{ ... }` clause binds to a banned hook, following `useEffect as x` aliases. */
function bannedLocalNames(named) {
  if (!named || !ts.isNamedImports(named)) return [];
  return named.elements
    .filter((spec) => BANNED.has((spec.propertyName ?? spec.name).text))
    .map((spec) => spec.name.text);
}

/** Local names in one file that refer to a banned hook, plus the React namespace names. */
export function reactBindings(root) {
  const direct = [];
  const namespaces = [];
  for (const statement of root.statements) {
    const clause = reactImportClause(statement);
    if (!clause) continue;
    namespaces.push(...namespaceNames(clause));
    direct.push(...bannedLocalNames(clause.namedBindings));
  }
  return { direct: new Set(direct), namespaces: new Set(namespaces) };
}

/**
 * One source file as an AST. Exported so a test parses exactly the way the scan does, rather than
 * keeping a second copy of these options that can drift from the one that actually runs.
 */
export function parse(file, text) {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** `React.useEffect(...)`, where the object is a name bound to the React namespace. */
function isNamespacedCallee(callee, namespaces) {
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    namespaces.has(callee.expression.text) &&
    BANNED.has(callee.name.text)
  );
}

/** Whether what is being called resolves to a banned hook, by either spelling. */
function isBannedCallee(callee, direct, namespaces) {
  return ts.isIdentifier(callee) ? direct.has(callee.text) : isNamespacedCallee(callee, namespaces);
}

/** Line numbers of every banned-hook call in one file. */
export function callSites(file, text = readFileSync(join(ROOT, file), "utf8")) {
  const root = parse(file, text);
  const { direct, namespaces } = reactBindings(root);
  const lines = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && isBannedCallee(node.expression, direct, namespaces))
      lines.push(root.getLineAndCharacterOfPosition(node.getStart(root)).line + 1);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return lines;
}

/** Every offending file under SCANNED, mapped to the lines its banned hooks sit on. */
function scan() {
  const found = new Map();
  for (const file of sources()) {
    if (SANCTIONED.has(file)) continue;
    const lines = callSites(file);
    if (lines.length > 0) found.set(file, lines);
  }
  return found;
}

/** What is wrong with one offending file, or null when it is within its budget. */
function budgetProblem(file, lines, budget) {
  const allowed = budget.get(file);
  if (allowed === undefined)
    return (
      `NEW banned effect hook: ${file}:${lines.join(", :")}\n` +
      `    The ban is absolute. Use useMountEffect() for a one-time external sync, or derive\n` +
      `    the value during render. See CLAUDE.md > React Rules.`
    );
  if (lines.length > allowed)
    return (
      `OVER BUDGET: ${file} has ${lines.length}, budget allows ${allowed}\n` +
      `    Lines: ${lines.join(", ")}. The budget is debt, not headroom.`
    );
  return null;
}

/** What is wrong with one budget entry the file has since paid down, or null when it is honest. */
function staleProblem(file, allowed, actual) {
  if (actual >= allowed) return null;
  const fix = actual === 0 ? "Delete the entry." : `Lower it to ${actual}.`;
  return (
    `STALE budget entry: ${file} now has ${actual}, budget still says ${allowed}\n` +
    `    ${fix} Thanks for paying the debt down.`
  );
}

/** Every way the scan disagrees with the register, in file order then budget order. */
export function listBudgetIssues(found, budget = BUDGET) {
  return [
    ...[...found].map(([file, lines]) => budgetProblem(file, lines, budget)),
    ...[...budget].map(([file, allowed]) =>
      staleProblem(file, allowed, found.get(file)?.length ?? 0),
    ),
  ].filter((problem) => problem !== null);
}

function main() {
  const problems = listBudgetIssues(scan());
  const scanned = sources();
  for (const file of SANCTIONED.keys()) {
    if (!scanned.includes(file))
      problems.push(`SANCTIONED lists a file that no longer exists: ${file}`);
  }
  const debt = [...BUDGET.values()].reduce((total, count) => total + count, 0);
  if (problems.length === 0) {
    console.log(
      `no-use-effect: no new useEffect or useLayoutEffect in ${SCANNED}. ` +
        `${debt} budgeted call site(s) across ${BUDGET.size} file(s) remain.`,
    );
    return;
  }
  problems.forEach((problem) => console.error(problem));
  console.error(
    `\n${problems.length} problem(s). Budgeted debt is ${debt} across ${BUDGET.size} files.`,
  );
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
