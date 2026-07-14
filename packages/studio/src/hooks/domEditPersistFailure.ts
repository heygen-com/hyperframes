import type { DomEditSelection } from "../components/editor/domEditing";
import i18n from "../i18n";
import { StudioSaveHttpError } from "../utils/studioSaveDiagnostics";
import type { PatchOperation } from "../utils/sourcePatcher";

export class DomEditPersistUnresolvableError extends Error {
  constructor(targetPath: string) {
    super(i18n.t("hooks.domEdit.elementNotFoundInSource", { targetPath }));
    this.name = "DomEditPersistUnresolvableError";
  }
}

export class DomEditPersistUnsafeValueError extends Error {
  readonly alreadyToasted: boolean;

  constructor(message: string, options: { alreadyToasted?: boolean } = {}) {
    super(message);
    this.name = "DomEditPersistUnsafeValueError";
    this.alreadyToasted = options.alreadyToasted ?? false;
  }
}

export class DomEditPersistUnsupportedTextStructureError extends Error {
  constructor() {
    super(i18n.t("hooks.domEdit.textStructureChangeFailed"));
    this.name = "DomEditPersistUnsupportedTextStructureError";
  }
}

export type DomEditPersistFailureSelection = Pick<
  DomEditSelection,
  "label" | "hfId" | "id" | "selector" | "selectorIndex" | "sourceFile"
>;

function summarizeOperations(operations: PatchOperation[]): string {
  return operations.map((op) => `${op.type}:${op.property}`).join(", ");
}

function getTargetTuple(selection: DomEditPersistFailureSelection) {
  return {
    hfId: selection.hfId,
    id: selection.id,
    selector: selection.selector,
    selectorIndex: selection.selectorIndex,
    sourceFile: selection.sourceFile,
  };
}

function getErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getSelectionLabel(selection: DomEditPersistFailureSelection): string {
  return (
    selection.label || selection.selector || selection.id || i18n.t("hooks.domEdit.thisElement")
  );
}

export function reportDomEditPersistFailure(
  selection: DomEditPersistFailureSelection,
  operations: PatchOperation[],
  error: unknown,
  showToast: (message: string, tone?: "error" | "info") => void,
): void {
  const detail = getErrorDetail(error);
  console.warn("[Studio] DOM edit persist failed", {
    target: getTargetTuple(selection),
    operations: summarizeOperations(operations),
    error: detail,
  });

  const wasAlreadyToasted =
    (error instanceof DomEditPersistUnsafeValueError || error instanceof StudioSaveHttpError) &&
    error.alreadyToasted;
  if (wasAlreadyToasted) {
    return;
  }

  showToast(
    i18n.t("hooks.domEdit.saveFailed", { label: getSelectionLabel(selection), detail }),
    "error",
  );
}

export function warnDomEditPersistNoOp(
  selection: DomEditPersistFailureSelection,
  operations: PatchOperation[],
): void {
  console.warn("[Studio] DOM edit persist no-op", {
    target: getTargetTuple(selection),
    operations: summarizeOperations(operations),
    detail:
      "Server matched the target but reported no change even though the client believed the value changed.",
  });
}
