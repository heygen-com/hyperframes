export interface VerificationFailure {
  id?: string;
  category: string;
  message: string;
  fixture?: "canonical" | "demo";
  theme?: "dark" | "light";
  viewport?: string;
  checkpoint?: string;
}

interface VerificationModel {
  scope: {
    version: number;
    name: string;
    items: string[];
  };
  states: {
    version: number;
    name: string;
    items: Array<{
      id: string;
      focusTarget: string;
      renderCheckpoints: string[];
    }>;
  };
  checkpoints: {
    version: number;
    selection: string;
    sequentialPasses: number;
    shuffledPasses: number;
    includeMidpoint: boolean;
    includeFinalFrame: boolean;
    fps: number;
    theme: string;
    viewport: string;
  };
}

export interface RectSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PresentationSnapshot {
  viewport: { width: number; height: number };
  documentScrollWidth: number;
  documentScrollHeight: number;
  root: RectSnapshot;
  visiblePaintedNodes: number;
}

export interface TargetSnapshot {
  selector: string;
  containers?: string[];
  requiresDefaultControlFace: boolean;
  visual: RectSnapshot;
  effective: RectSnapshot;
}

export interface VerificationSummary {
  primitives: { total: number; passed: number; failed: number };
  checks: { total: number; passed: number; failed: number };
  failureCategories: Record<string, number>;
}

export interface SemanticSnapshot {
  axeViolations: Array<{
    id: string;
    impact: string | null;
    targets: string[];
  }>;
  unnamedControls: string[];
  brokenAriaReferences: string[];
  duplicateIds: string[];
  focus: {
    selector: string;
    found: boolean;
    focusable: boolean;
    sequential: boolean;
    indicatorVisible: boolean;
    ringContained: boolean;
    visible: boolean;
    unobscured: boolean;
  } | null;
  reducedMotionMoving: string[];
}

export interface SemanticStateSnapshot {
  state: "open" | "closed";
  mode: "controlled" | "root";
  relationshipValid: boolean;
  root: {
    found: boolean;
    hidden: boolean;
    inert: boolean;
    axPresent: boolean;
  };
  controller: {
    found: boolean;
    expanded: string | null;
    sequential: boolean;
    programmatic: boolean;
    axPresent: boolean;
  } | null;
  region: {
    found: boolean;
    hidden: boolean;
    inert: boolean;
    sequentialFocusables: string[];
    programmaticFocusables: string[];
    axPresent: boolean;
  };
  axeViolations: Array<{
    id: string;
    impact: string | null;
    targets: string[];
  }>;
}

export interface TimelineSnapshot {
  declared: string[];
  labels: Record<string, number>;
  seekErrors: Array<{ checkpoint: string; message: string }>;
  consoleErrors: string[];
  pageErrors: string[];
  finalState: { stable: boolean; painted: boolean };
}

export interface CanonicalParitySnapshot {
  canonicalSource: string;
  demoCanonicalSource: string;
  canonicalHash: string;
  demoCanonicalHash: string;
}

export interface ThemeLayoutNode {
  path: string;
  values: Array<string | number>;
}

export interface CliOptions {
  json: boolean;
  only: string | null;
  artifactsDir: string | null;
  updateFrameHashes: boolean;
}

function failure(category: string, message: string): VerificationFailure {
  return { category, message };
}

function sameMembers(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

export function validateVerificationModel(model: VerificationModel): VerificationFailure[] {
  const failures: VerificationFailure[] = [];
  if (model.scope.items.length !== 66) {
    failures.push(failure("scope.count", `expected 66 items, found ${model.scope.items.length}`));
  }
  if (model.scope.items.join("\n") !== model.scope.items.toSorted().join("\n")) {
    failures.push(failure("scope.order", "scope items must be sorted"));
  }
  if (new Set(model.scope.items).size !== model.scope.items.length) {
    failures.push(failure("scope.unique", "scope items must be unique"));
  }
  const stateIds = model.states.items.map((item) => item.id);
  if (!sameMembers(model.scope.items, stateIds)) {
    failures.push(failure("states.coverage", "state inventory must cover the exact scope"));
  }
  if (new Set(stateIds).size !== stateIds.length) {
    failures.push(failure("states.unique", "state inventory IDs must be unique"));
  }
  if (model.checkpoints.selection !== "declared-plus-midpoint-final-frame") {
    failures.push(
      failure(
        "determinism.selection",
        "checkpoint selection must include every declared label, midpoint, and final frame",
      ),
    );
  }
  if (model.checkpoints.sequentialPasses !== 3) {
    failures.push(
      failure(
        "determinism.sequential-passes",
        "checkpoint verification requires three sequential passes",
      ),
    );
  }
  if (model.checkpoints.shuffledPasses !== 1) {
    failures.push(
      failure("determinism.shuffled-passes", "checkpoint verification requires one shuffled pass"),
    );
  }
  if (!model.checkpoints.includeMidpoint) {
    failures.push(failure("determinism.midpoint", "checkpoint verification must include midpoint"));
  }
  if (!model.checkpoints.includeFinalFrame) {
    failures.push(
      failure("determinism.final-frame", "checkpoint verification must include final valid frame"),
    );
  }
  if (model.checkpoints.fps !== 30) {
    failures.push(
      failure("determinism.fps", "checkpoint verification must use the pinned 30fps grid"),
    );
  }
  if (model.checkpoints.theme !== "dark") {
    failures.push(failure("determinism.theme", "checkpoint theme must be pinned to dark"));
  }
  if (model.checkpoints.viewport !== "desktop-1440") {
    failures.push(
      failure("determinism.viewport", "checkpoint viewport must be pinned to desktop-1440"),
    );
  }
  return failures;
}

export function auditPresentation(
  snapshot: PresentationSnapshot,
  options: { allowVerticalScroll?: boolean } = {},
): VerificationFailure[] {
  const failures: VerificationFailure[] = [];
  if (snapshot.root.width <= 0 || snapshot.root.height <= 0) {
    failures.push(failure("layout.nonzero", "root has no measurable presentation"));
  }
  if (snapshot.documentScrollWidth > snapshot.viewport.width + 0.5) {
    failures.push(
      failure(
        "layout.horizontal-overflow",
        `document width ${snapshot.documentScrollWidth}px exceeds ${snapshot.viewport.width}px`,
      ),
    );
  }
  if (
    !options.allowVerticalScroll &&
    snapshot.documentScrollHeight > snapshot.viewport.height + 0.5
  ) {
    failures.push(
      failure(
        "layout.vertical-overflow",
        `document height ${snapshot.documentScrollHeight}px exceeds ${snapshot.viewport.height}px`,
      ),
    );
  }
  const right = snapshot.root.x + snapshot.root.width;
  if (snapshot.root.x < -0.5 || right > snapshot.viewport.width + 0.5) {
    failures.push(
      failure(
        "layout.horizontal-clipping",
        `root spans ${snapshot.root.x}px to ${right}px in ${snapshot.viewport.width}px`,
      ),
    );
  }
  const bottom = snapshot.root.y + snapshot.root.height;
  if (
    !options.allowVerticalScroll &&
    (snapshot.root.y < -0.5 || bottom > snapshot.viewport.height + 0.5)
  ) {
    failures.push(
      failure(
        "layout.vertical-clipping",
        `root spans ${snapshot.root.y}px to ${bottom}px in ${snapshot.viewport.height}px`,
      ),
    );
  }
  if (snapshot.visiblePaintedNodes <= 0) {
    failures.push(failure("layout.paint", "root has no visible text, border, fill, or graphic"));
  }
  return failures;
}

function overlap(left: RectSnapshot, right: RectSnapshot): boolean {
  const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  return width > 0.5 && height > 0.5;
}

export function auditTargetGeometry(
  targets: TargetSnapshot[],
  coarsePointer = true,
): VerificationFailure[] {
  const failures: VerificationFailure[] = [];
  for (const target of targets) {
    if (
      target.requiresDefaultControlFace &&
      (target.visual.width < 40 || target.visual.height < 40)
    ) {
      failures.push(
        failure(
          "target.visual-size",
          `${target.selector} visual box is ${target.visual.width}×${target.visual.height}`,
        ),
      );
    }
    if (coarsePointer && (target.effective.width < 44 || target.effective.height < 44)) {
      failures.push(
        failure(
          "target.coarse-size",
          `${target.selector} coarse box is ${target.effective.width}×${target.effective.height}`,
        ),
      );
    }
  }
  if (!coarsePointer) return failures;
  for (let leftIndex = 0; leftIndex < targets.length; leftIndex += 1) {
    const left = targets[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < targets.length; rightIndex += 1) {
      const right = targets[rightIndex];
      if (!right) continue;
      const nested =
        (left.containers ?? []).includes(right.selector) ||
        (right.containers ?? []).includes(left.selector);
      if (nested || !overlap(left.effective, right.effective)) continue;
      failures.push(
        failure("target.overlap", `${left.selector} overlaps ${right.selector} in coarse mode`),
      );
    }
  }
  return failures;
}

export function auditSemanticSnapshot(snapshot: SemanticSnapshot): VerificationFailure[] {
  const failures: VerificationFailure[] = [];
  for (const violation of snapshot.axeViolations) {
    if (violation.impact !== "serious" && violation.impact !== "critical") continue;
    failures.push(
      failure(
        `accessibility.axe-${violation.impact}`,
        `${violation.id}: ${violation.targets.join(", ")}`,
      ),
    );
  }
  for (const selector of snapshot.unnamedControls) {
    failures.push(failure("accessibility.name", `${selector} has no accessible name`));
  }
  for (const reference of snapshot.brokenAriaReferences) {
    failures.push(failure("accessibility.aria-reference", reference));
  }
  for (const id of snapshot.duplicateIds) {
    failures.push(failure("accessibility.duplicate-id", `duplicate id ${id}`));
  }
  if (snapshot.focus !== null && !snapshot.focus.found) {
    failures.push(failure("focus.missing", `missing focus target ${snapshot.focus.selector}`));
  } else if (snapshot.focus !== null) {
    if (!snapshot.focus.focusable) {
      failures.push(
        failure(
          "focus.unfocusable",
          `${snapshot.focus.selector} cannot receive programmatic focus`,
        ),
      );
    }
    if (!snapshot.focus.sequential) {
      failures.push(
        failure(
          "focus.not-sequential",
          `${snapshot.focus.selector} is not in sequential focus order`,
        ),
      );
    }
    if (!snapshot.focus.indicatorVisible) {
      failures.push(
        failure(
          "focus.indicator-missing",
          `${snapshot.focus.selector} has no visible focus indicator`,
        ),
      );
    }
    if (!snapshot.focus.ringContained) {
      failures.push(
        failure("focus.ring-clipped", `${snapshot.focus.selector} focus ring is clipped`),
      );
    }
    if (!snapshot.focus.visible) {
      failures.push(failure("focus.clipped", `${snapshot.focus.selector} is outside the viewport`));
    }
    if (!snapshot.focus.unobscured) {
      failures.push(
        failure("focus.obscured", `${snapshot.focus.selector} is covered by other content`),
      );
    }
  }
  for (const movement of snapshot.reducedMotionMoving) {
    failures.push(failure("motion.reduced-css", movement));
  }
  return failures;
}

export function auditSemanticStateSnapshot(snapshot: SemanticStateSnapshot): VerificationFailure[] {
  const failures: VerificationFailure[] = [];
  for (const violation of snapshot.axeViolations) {
    if (violation.impact !== "serious" && violation.impact !== "critical") continue;
    failures.push(
      failure(
        `state.accessibility.axe-${violation.impact}`,
        `${violation.id}: ${violation.targets.join(", ")}`,
      ),
    );
  }
  if (!snapshot.root.found) {
    failures.push(failure("state.root-missing", "semantic fixture has no canonical root"));
  }
  if (!snapshot.region.found) {
    failures.push(failure("state.region-missing", "semantic fixture has no state region"));
  }
  if (!snapshot.relationshipValid) {
    failures.push(
      failure("state.relationship", "controller relationship does not resolve to the state region"),
    );
  }

  if (snapshot.mode === "controlled") {
    if (snapshot.controller === null || !snapshot.controller.found) {
      failures.push(failure("state.controller-missing", "controlled fixture has no controller"));
    } else {
      const expectedExpanded = snapshot.state === "open" ? "true" : "false";
      if (snapshot.controller.expanded !== expectedExpanded) {
        failures.push(
          failure(
            "state.expanded",
            `controller aria-expanded must be ${expectedExpanded}, found ${snapshot.controller.expanded ?? "missing"}`,
          ),
        );
      }
      if (!snapshot.controller.sequential || !snapshot.controller.programmatic) {
        failures.push(
          failure("state.controller-focus", "controller must remain keyboard focusable"),
        );
      }
      if (!snapshot.controller.axPresent) {
        failures.push(
          failure("state.controller-ax", "controller is absent from the accessibility tree"),
        );
      }
    }
  }

  if (snapshot.state === "open") {
    if (snapshot.root.hidden || snapshot.root.inert) {
      failures.push(failure("state.open-root-inert", "open root is hidden or inert"));
    }
    if (!snapshot.root.axPresent) {
      failures.push(
        failure("state.open-root-ax", "open root is absent from the accessibility tree"),
      );
    }
    if (snapshot.region.hidden || snapshot.region.inert) {
      failures.push(failure("state.open-region-inert", "open region is hidden or inert"));
    }
    if (!snapshot.region.axPresent) {
      failures.push(
        failure("state.open-region-ax", "open region is absent from the accessibility tree"),
      );
    }
    return failures;
  }

  if (!snapshot.region.hidden) {
    failures.push(failure("state.closed-not-hidden", "closed region is not structurally hidden"));
  }
  if (!snapshot.region.inert) {
    failures.push(failure("state.closed-not-inert", "closed region is not inert"));
  }
  if (snapshot.region.sequentialFocusables.length > 0) {
    failures.push(
      failure(
        "state.closed-sequential-focus",
        `closed region retains sequential focus: ${snapshot.region.sequentialFocusables.join(", ")}`,
      ),
    );
  }
  if (snapshot.region.programmaticFocusables.length > 0) {
    failures.push(
      failure(
        "state.closed-programmatic-focus",
        `closed region accepts programmatic focus: ${snapshot.region.programmaticFocusables.join(", ")}`,
      ),
    );
  }
  if (snapshot.region.axPresent) {
    failures.push(
      failure("state.closed-ax-visible", "closed region remains in the accessibility tree"),
    );
  }
  if (snapshot.mode === "root" && (!snapshot.root.hidden || !snapshot.root.inert)) {
    failures.push(
      failure(
        "state.closed-root-active",
        "controller-less closed overlay must be hidden and inert",
      ),
    );
  }
  return failures;
}

export function auditTimelineSnapshot(snapshot: TimelineSnapshot): VerificationFailure[] {
  const failures: VerificationFailure[] = [];
  for (const checkpoint of snapshot.declared) {
    if (Number.isFinite(snapshot.labels[checkpoint])) continue;
    failures.push(failure("timeline.label-missing", `missing timeline label ${checkpoint}`));
  }
  for (const error of snapshot.seekErrors) {
    failures.push(failure("timeline.seek", `${error.checkpoint}: ${error.message}`));
  }
  for (const error of snapshot.consoleErrors) {
    failures.push(failure("runtime.console", error));
  }
  for (const error of snapshot.pageErrors) {
    failures.push(failure("runtime.page", error));
  }
  if (!snapshot.finalState.stable) {
    failures.push(failure("timeline.final-unstable", "final checkpoint changes at its boundary"));
  }
  if (!snapshot.finalState.painted) {
    failures.push(failure("timeline.final-unpainted", "final checkpoint has no visible paint"));
  }
  return failures;
}

export function auditCanonicalParity(snapshot: CanonicalParitySnapshot): VerificationFailure[] {
  const failures: VerificationFailure[] = [];
  if (snapshot.canonicalSource.trim() !== snapshot.demoCanonicalSource.trim()) {
    failures.push(
      failure("parity.source", "demo canonical payload differs from standalone source"),
    );
  }
  if (snapshot.canonicalHash !== snapshot.demoCanonicalHash) {
    failures.push(failure("parity.render", "demo canonical pixels differ from standalone pixels"));
  }
  return failures;
}

export function auditThemeLayoutParity(
  dark: ThemeLayoutNode[],
  light: ThemeLayoutNode[],
): VerificationFailure[] {
  if (JSON.stringify(dark) === JSON.stringify(light)) return [];
  const mismatchIndex = Math.max(
    0,
    dark.findIndex((node, index) => {
      const counterpart = light[index];
      return counterpart === undefined || JSON.stringify(node) !== JSON.stringify(counterpart);
    }),
  );
  const path = dark[mismatchIndex]?.path ?? light[mismatchIndex]?.path ?? "root";
  return [failure("parity.theme-layout", `dark/light non-color layout differs at ${path}`)];
}

export function parseArgs(args = process.argv.slice(2)): CliOptions {
  let json = false;
  let only: string | null = null;
  let artifactsDir: string | null = null;
  let updateFrameHashes = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--only" && args[index + 1]) {
      if (only !== null) throw new Error("--only may be supplied only once");
      only = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--artifacts-dir" && args[index + 1]) {
      if (artifactsDir !== null) throw new Error("--artifacts-dir may be supplied only once");
      artifactsDir = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--update-frame-hashes") {
      if (updateFrameHashes) throw new Error("--update-frame-hashes may be supplied only once");
      updateFrameHashes = true;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${argument ?? ""}`);
  }
  return { json, only, artifactsDir, updateFrameHashes };
}

function frameId(key: string): string {
  return key.split(":", 1)[0] ?? key;
}

export function compareFrameHashPasses(
  passOne: Record<string, string>,
  passTwo: Record<string, string>,
): VerificationFailure[] {
  const failures: VerificationFailure[] = [];
  for (const [key, firstHash] of Object.entries(passOne)) {
    const secondHash = passTwo[key];
    if (secondHash === undefined) {
      failures.push({
        id: frameId(key),
        category: "determinism.missing-pass-two",
        message: `${key} is missing from pass two`,
      });
    } else if (firstHash !== secondHash) {
      failures.push({
        id: frameId(key),
        category: "determinism.hash-mismatch",
        message: `${key} differs between screenshot passes`,
      });
    }
  }
  for (const key of Object.keys(passTwo)) {
    if (passOne[key] !== undefined) continue;
    failures.push({
      id: frameId(key),
      category: "determinism.missing-pass-one",
      message: `${key} is missing from pass one`,
    });
  }
  return failures;
}

export function buildVerificationSummary(
  ids: string[],
  totalChecks: number,
  failures: VerificationFailure[],
): VerificationSummary {
  const failedIds = new Set(
    failures.flatMap((entry) => (entry.id === undefined ? [] : [entry.id])),
  );
  const failureCategories: Record<string, number> = {};
  for (const entry of failures) {
    failureCategories[entry.category] = (failureCategories[entry.category] ?? 0) + 1;
  }
  return {
    primitives: {
      total: ids.length,
      passed: ids.length - failedIds.size,
      failed: failedIds.size,
    },
    checks: {
      total: totalChecks,
      passed: Math.max(0, totalChecks - failures.length),
      failed: failures.length,
    },
    failureCategories,
  };
}
