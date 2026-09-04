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
//
// Spellings, and how far resolution reaches. Every form below is either DETECTED or listed as OUT
// OF SCOPE with its reason; none is silently unhandled.
//
//   DETECTED  `import { useEffect }`, `import { useEffect as x }`, `import React from "react"` +
//             `React.useEffect`, `import * as R from "react"` + `R.useLayoutEffect`.
//   DETECTED  computed namespace access: `React["useEffect"]`.
//   DETECTED  runtime loads of the module -- `require` and dynamic `import`, awaited or not --
//             with the namespace either bound (`const R = await import(<react>)`) or destructured
//             (`const { useEffect } = require(<react>)`). `<react>` stands for the literal module
//             specifier: spelling it out inside these parentheses makes the repository's
//             dependency audit read this comment as a real import of react.
//   DETECTED  local aliases, transitively: `const e = useEffect`, then `const f = e`, and
//             `const e = React["useEffect"]`.
//   DETECTED  a barrel re-export written UNDER the scanned tree: `export { useEffect } from "react"`
//             and `export * from "react"` fail in the barrel itself, so importing the hook through
//             a local barrel cannot launder it. The barrel is the file that has to exist for the
//             bypass, and it is in scope, so the bypass is closed where it is written.
//   DETECTED  `.js` and `.jsx` sources, on the same terms as `.ts` and `.tsx`.
//   OUT OF SCOPE  a barrel OUTSIDE the scanned tree -- another workspace package re-exporting react.
//             Catching it needs cross-package module resolution: a resolver plus a whole-program
//             parse, to close a route that does not exist today (no file under `packages/`
//             re-exports react at all). If one is ever written, ban it where it is written, the way
//             the in-scope rule above already does.
//   OUT OF SCOPE  indirection no static pass can follow: `React[flag ? "useEffect" : "useMemo"]`, a
//             hook pulled out of a data structure, `eval`. A ratchet resists drift, not an author
//             deliberately defeating it -- that author can equally well edit BUDGET below.

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

/** Studio source the ban applies to: JavaScript and TypeScript, minus the ambient declarations. */
export function isScannedSource(name) {
  return /\.[jt]sx?$/.test(name) && !name.endsWith(".d.ts");
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

/** Whether a callee loads a module at runtime: the `import` keyword, or `require`. */
function isModuleLoader(callee) {
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return true;
  return ts.isIdentifier(callee) && callee.text === "require";
}

/** The literal module specifier a call loads, or undefined when it is not a literal. */
function loadedModule(node) {
  const [specifier] = node.arguments;
  return specifier && ts.isStringLiteralLike(specifier) ? specifier.text : undefined;
}

/** Whether a call loads the react module, by `require` or by dynamic `import`. */
function isReactModuleCall(node) {
  return isModuleLoader(node.expression) && loadedModule(node) === "react";
}

/** The expression under any number of `await` and parenthesis wrappers. */
function unwrap(expression) {
  let node = expression;
  while (ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}

/** Whether an expression evaluates to the React namespace, by name or by loading the module. */
function isReactNamespace(wrapped, namespaces) {
  const expression = unwrap(wrapped);
  if (ts.isIdentifier(expression)) return namespaces.has(expression.text);
  return ts.isCallExpression(expression) && isReactModuleCall(expression);
}

/** The property a member access reads, spelled either `x.y` or `x["y"]`. */
function memberName(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isStringLiteralLike(expression.argumentExpression)
  )
    return expression.argumentExpression.text;
  return undefined;
}

/** Whether an expression resolves to a banned hook: a bound local, or React's member by any spelling. */
function isBannedExpression(expression, direct, namespaces) {
  if (ts.isIdentifier(expression)) return direct.has(expression.text);
  const name = memberName(expression);
  return (
    name !== undefined && BANNED.has(name) && isReactNamespace(expression.expression, namespaces)
  );
}

/** The banned names a `const { useEffect } = <react>` pattern binds, in their local spelling. */
function destructuredNames(pattern) {
  return pattern.elements
    .filter((element) => ts.isIdentifier(element.propertyName ?? element.name))
    .filter((element) => BANNED.has((element.propertyName ?? element.name).text))
    .filter((element) => ts.isIdentifier(element.name))
    .map((element) => ({ kind: "direct", name: element.name.text }));
}

/** What `const x = ...` contributes: a hook alias, a React namespace alias, or nothing. */
function nameBindings(name, initializer, direct, namespaces) {
  if (isBannedExpression(initializer, direct, namespaces)) return [{ kind: "direct", name }];
  if (isReactNamespace(initializer, namespaces)) return [{ kind: "namespaces", name }];
  return [];
}

/** What `const { useEffect } = ...` contributes: the banned names it pulls off React. */
function patternBindings(pattern, initializer, namespaces) {
  return isReactNamespace(initializer, namespaces) ? destructuredNames(pattern) : [];
}

/** What one variable declaration adds to the bindings, whichever way it is written. */
function declaredBindings(declaration, direct, namespaces) {
  const { name, initializer } = declaration;
  if (!initializer) return [];
  if (ts.isObjectBindingPattern(name)) return patternBindings(name, initializer, namespaces);
  return ts.isIdentifier(name) ? nameBindings(name.text, initializer, direct, namespaces) : [];
}

/** Every node of one kind in a file, in source order. */
function collect(root, matches) {
  const found = [];
  const visit = (node) => {
    if (matches(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/** One resolution pass: every alias visible from the bindings as they currently stand. */
function addAliases(declarations, bindings) {
  for (const declaration of declarations)
    for (const found of declaredBindings(declaration, bindings.direct, bindings.namespaces))
      bindings[found.kind].add(found.name);
}

/** How many names the bindings hold: the only thing a pass can change. */
function bindingCount(bindings) {
  return bindings.direct.size + bindings.namespaces.size;
}

/**
 * Grow the bindings by every alias of them until a pass adds nothing, so a chain like
 * `const b = a; const a = useEffect;` resolves whatever order the declarations are written in.
 */
function resolveAliases(root, bindings) {
  const declarations = collect(root, ts.isVariableDeclaration);
  for (let previous = -1; previous !== bindingCount(bindings); ) {
    previous = bindingCount(bindings);
    addAliases(declarations, bindings);
  }
  return bindings;
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
  return resolveAliases(root, { direct: new Set(direct), namespaces: new Set(namespaces) });
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
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Every banned-hook call in one parsed file, as nodes. */
export function bannedCalls(root) {
  const { direct, namespaces } = reactBindings(root);
  return collect(
    root,
    (node) => ts.isCallExpression(node) && isBannedExpression(node.expression, direct, namespaces),
  );
}

/** The module a re-export pulls from, or undefined when the statement is not one. */
function reExportedModule(statement) {
  if (!ts.isExportDeclaration(statement)) return undefined;
  const specifier = statement.moduleSpecifier;
  return specifier && ts.isStringLiteral(specifier) ? specifier.text : undefined;
}

/** Whether an export clause hands out a banned hook. No clause is `export *`, which hands out all. */
function exportsBannedName(clause) {
  if (!clause) return true;
  return (
    ts.isNamedExports(clause) &&
    clause.elements.some((spec) => BANNED.has((spec.propertyName ?? spec.name).text))
  );
}

/** Whether a re-export hands a banned hook to other files: `export { useEffect } from "react"`. */
function isReactReExport(statement) {
  return reExportedModule(statement) === "react" && exportsBannedName(statement.exportClause);
}

/** Line numbers of every banned-hook call and every react re-export in one file. */
export function violations(file, text = readFileSync(join(ROOT, file), "utf8")) {
  const root = parse(file, text);
  const line = (node) => root.getLineAndCharacterOfPosition(node.getStart(root)).line + 1;
  const found = [...bannedCalls(root), ...root.statements.filter(isReactReExport)];
  return found.map(line).sort((a, b) => a - b);
}

/** The shape the sanctioned wrapper must keep: one `useEffect(effect, [])` and nothing else. */
function isMountEffectCall(node) {
  const [, deps] = node.arguments;
  return (
    node.arguments.length === 2 && ts.isArrayLiteralExpression(deps) && deps.elements.length === 0
  );
}

/**
 * How the sanctioned file departs from useMountEffect(), or null when it still matches. Skipping
 * the file wholesale would make it a hiding place: any effect, any dependency array, unchecked.
 */
export function sanctionedProblem(file, text = readFileSync(join(ROOT, file), "utf8")) {
  const calls = bannedCalls(parse(file, text));
  if (calls.length !== 1)
    return `SANCTIONED file drifted: ${file} has ${calls.length} banned hook calls, expected 1.`;
  if (!isMountEffectCall(calls[0]))
    return (
      `SANCTIONED file drifted: ${file} must call useEffect(effect, []) and nothing else.\n` +
      `    Its one effect now takes a different dependency array, which is a general effect.`
    );
  return null;
}

/** Every offending file under SCANNED, mapped to the lines its banned hooks sit on. */
function scan() {
  const found = new Map();
  for (const file of sources()) {
    if (SANCTIONED.has(file)) continue;
    const lines = violations(file);
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

/** Every way a sanctioned file fails to be the thing it was sanctioned for. */
export function listSanctionedIssues(scanned, sanctioned = SANCTIONED) {
  return [...sanctioned.keys()]
    .map((file) =>
      scanned.includes(file)
        ? sanctionedProblem(file)
        : `SANCTIONED lists a file that no longer exists: ${file}`,
    )
    .filter((problem) => problem !== null);
}

function main() {
  const problems = [...listBudgetIssues(scan()), ...listSanctionedIssues(sources())];
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
