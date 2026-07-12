import { useCallback, useRef } from "react";
import type { PatchOperation } from "../utils/sourcePatcher";
import {
  findElementForSelection,
  getDomEditTargetKey,
  type DomEditSelection,
} from "../components/editor/domEditing";
import type { PersistDomEditOperations } from "./domEditCommitTypes";
import { reportDomEditPersistFailure } from "./domEditPersistFailure";
import { bumpDomEditCommitMapVersion, runDomEditCommit } from "./domEditCommitRunner";

// ── Types ──

export interface UseDomEditAttributeCommitsParams {
  activeCompPath: string | null;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  domEditSelection: DomEditSelection | null;
  refreshDomEditSelectionFromPreview: (selection: DomEditSelection) => void;
  persistDomEditOperations: PersistDomEditOperations;
}

interface DataAttributeCommitOptions {
  label: string;
  coalescePrefix: string;
  skipRefresh: boolean;
  refreshAfter?: boolean;
}

function resolveFullAttrName(attr: string, prefixData: boolean | undefined): string {
  return prefixData && !attr.startsWith("data-") ? `data-${attr}` : attr;
}

function setOrRemovePreviewAttribute(
  el: HTMLElement,
  fullAttr: string,
  value: string | null,
): void {
  if (value === null) {
    el.removeAttribute(fullAttr);
  } else {
    el.setAttribute(fullAttr, value);
  }
}

function findPreviewAttributeElement(
  doc: Document | null | undefined,
  selection: DomEditSelection,
  activeCompPath: string | null,
): HTMLElement | null {
  if (!doc) return null;
  return findElementForSelection(doc, selection, activeCompPath);
}

interface CapturedAttributeElement {
  element: HTMLElement;
  previousValue: string | null;
}

function captureAttributeElement(
  doc: Document | null | undefined,
  selection: DomEditSelection,
  activeCompPath: string | null,
  fullAttr: string,
): CapturedAttributeElement | null {
  const el = findPreviewAttributeElement(doc, selection, activeCompPath);
  if (!el) return null;
  return { element: el, previousValue: el.getAttribute(fullAttr) };
}

// ── Hook ──

// data-* attribute commits and raw HTML-attribute commits (e.g. muted, loop):
// both revert the optimistic write on persist failure, version-guarded per
// target+attribute so a stale failure can't stomp a newer successful commit.
export function useDomEditAttributeCommits({
  activeCompPath,
  previewIframeRef,
  showToast,
  domEditSelection,
  refreshDomEditSelectionFromPreview,
  persistDomEditOperations,
}: UseDomEditAttributeCommitsParams) {
  const domAttributeCommitVersionRef = useRef(new Map<string, number>());

  const commitDataAttribute = useCallback(
    async (attr: string, value: string | null, options: DataAttributeCommitOptions) => {
      if (!domEditSelection) return;
      const iframe = previewIframeRef.current;
      const fullAttr = resolveFullAttrName(attr, true);
      const commitKey = `${options.coalescePrefix}:${attr}:${getDomEditTargetKey(domEditSelection)}`;
      const isLatestCommit = bumpDomEditCommitMapVersion(
        domAttributeCommitVersionRef.current,
        commitKey,
      );
      const op: PatchOperation = { type: "attribute", property: attr, value };
      let editedElement: HTMLElement | null = null;
      let previousValue: string | null = null;

      await runDomEditCommit({
        capture: () => {
          const captured = captureAttributeElement(
            iframe?.contentDocument,
            domEditSelection,
            activeCompPath,
            fullAttr,
          );
          if (!captured) return;
          editedElement = captured.element;
          previousValue = captured.previousValue;
        },
        apply: () => {
          if (!editedElement) return;
          const nextValue = value === null || value === "" ? null : value;
          setOrRemovePreviewAttribute(editedElement, fullAttr, nextValue);
        },
        persist: () =>
          persistDomEditOperations(domEditSelection, [op], {
            label: options.label,
            coalesceKey: commitKey,
            skipRefresh: options.skipRefresh,
          }),
        shouldRevert: () => isLatestCommit(),
        revert: () => {
          if (!editedElement) return;
          setOrRemovePreviewAttribute(editedElement, fullAttr, previousValue);
        },
        onError: (error) => reportDomEditPersistFailure(domEditSelection, [op], error, showToast),
        shouldResync: () => isLatestCommit() && !!options.refreshAfter,
        resync: () => refreshDomEditSelectionFromPreview(domEditSelection),
      });
    },
    [
      activeCompPath,
      domEditSelection,
      persistDomEditOperations,
      refreshDomEditSelectionFromPreview,
      showToast,
      previewIframeRef,
    ],
  );

  const handleDomAttributeCommit = useCallback(
    async (attr: string, value: string) => {
      await commitDataAttribute(attr, value, {
        label: `Edit ${attr.replace(/-/g, " ")}`,
        coalescePrefix: "attr",
        skipRefresh: false,
        refreshAfter: true,
      });
    },
    [commitDataAttribute],
  );

  const handleDomAttributeLiveCommit = useCallback(
    async (attr: string, value: string | null) => {
      await commitDataAttribute(attr, value, {
        label: `Edit ${attr.replace(/^(data-)?/, "").replace(/-/g, " ")}`,
        coalescePrefix: "attr-live",
        skipRefresh: true,
      });
    },
    [commitDataAttribute],
  );

  const handleDomHtmlAttributeCommit = useCallback(
    async (attr: string, value: string | null) => {
      if (!domEditSelection) return;
      const iframe = previewIframeRef.current;
      const commitKey = `html-attr:${attr}:${getDomEditTargetKey(domEditSelection)}`;
      const isLatestCommit = bumpDomEditCommitMapVersion(
        domAttributeCommitVersionRef.current,
        commitKey,
      );
      const op: PatchOperation = { type: "html-attribute", property: attr, value };
      let editedElement: HTMLElement | null = null;
      let previousValue: string | null = null;

      await runDomEditCommit({
        capture: () => {
          const captured = captureAttributeElement(
            iframe?.contentDocument,
            domEditSelection,
            activeCompPath,
            attr,
          );
          if (!captured) return;
          editedElement = captured.element;
          previousValue = captured.previousValue;
        },
        apply: () => {
          if (!editedElement) return;
          const nextValue = value === null || value === "false" ? null : value;
          setOrRemovePreviewAttribute(editedElement, attr, nextValue);
        },
        persist: () =>
          persistDomEditOperations(domEditSelection, [op], {
            label: `Edit ${attr}`,
            coalesceKey: commitKey,
            skipRefresh: false,
          }),
        shouldRevert: () => isLatestCommit(),
        revert: () => {
          if (!editedElement) return;
          setOrRemovePreviewAttribute(editedElement, attr, previousValue);
        },
        onError: (error) => reportDomEditPersistFailure(domEditSelection, [op], error, showToast),
        shouldResync: () => isLatestCommit(),
        resync: () => refreshDomEditSelectionFromPreview(domEditSelection),
      });
    },
    [
      activeCompPath,
      domEditSelection,
      persistDomEditOperations,
      refreshDomEditSelectionFromPreview,
      showToast,
      previewIframeRef,
    ],
  );

  return {
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomHtmlAttributeCommit,
  };
}
