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
  onSettled?: (ok: boolean) => void;
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

interface CapturedMultiAttributeElement {
  element: HTMLElement;
  previousValues: Map<string, string | null>;
}

function captureMultiAttributeElement(
  doc: Document | null | undefined,
  selection: DomEditSelection,
  activeCompPath: string | null,
  fullAttrs: string[],
): CapturedMultiAttributeElement | null {
  const el = findPreviewAttributeElement(doc, selection, activeCompPath);
  if (!el) return null;
  const previousValues = new Map(
    fullAttrs.map((fullAttr) => [fullAttr, el.getAttribute(fullAttr)]),
  );
  return { element: el, previousValues };
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
        onSettled: options.onSettled,
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

  // Commits several data-* attributes on the SAME element in ONE persist call
  // — needed when two attributes together describe a single logical value
  // (e.g. a pinned timing range's start+duration): committing them through two
  // separate sequential `commitDataAttribute` calls leaves a window where the
  // second call resolves `domEditSelection` fresh from current hook state, so
  // a selection change between the two awaits would misdirect it at the
  // NEWLY selected element instead of the one being edited, and a failure of
  // just the second call would leave the two attributes in an inconsistent
  // half-applied state. Bundling them into one `PatchOperation[]` against an
  // explicit, caller-supplied `selection` (not the "current" one) closes both
  // gaps — matching `onCommitAnimatedProperties`'s same-shaped fix for GSAP
  // property batches.
  const commitDataAttributes = useCallback(
    async (
      selection: DomEditSelection,
      attrs: Record<string, string | null>,
      options: DataAttributeCommitOptions,
    ) => {
      const iframe = previewIframeRef.current;
      const entries = Object.entries(attrs).map(([attr, value]) => ({
        attr,
        fullAttr: resolveFullAttrName(attr, true),
        value,
      }));
      const commitKey = `${options.coalescePrefix}:${entries
        .map((entry) => entry.attr)
        .sort()
        .join(",")}:${getDomEditTargetKey(selection)}`;
      const isLatestCommit = bumpDomEditCommitMapVersion(
        domAttributeCommitVersionRef.current,
        commitKey,
      );
      const ops: PatchOperation[] = entries.map((entry) => ({
        type: "attribute",
        property: entry.attr,
        value: entry.value,
      }));
      let captured: CapturedMultiAttributeElement | null = null;

      await runDomEditCommit({
        capture: () => {
          captured = captureMultiAttributeElement(
            iframe?.contentDocument,
            selection,
            activeCompPath,
            entries.map((entry) => entry.fullAttr),
          );
        },
        apply: () => {
          if (!captured) return;
          for (const entry of entries) {
            const nextValue = entry.value === null || entry.value === "" ? null : entry.value;
            setOrRemovePreviewAttribute(captured.element, entry.fullAttr, nextValue);
          }
        },
        persist: () =>
          persistDomEditOperations(selection, ops, {
            label: options.label,
            coalesceKey: commitKey,
            skipRefresh: options.skipRefresh,
          }),
        shouldRevert: () => isLatestCommit(),
        revert: () => {
          if (!captured) return;
          for (const entry of entries) {
            setOrRemovePreviewAttribute(
              captured.element,
              entry.fullAttr,
              captured.previousValues.get(entry.fullAttr) ?? null,
            );
          }
        },
        onError: (error) => reportDomEditPersistFailure(selection, ops, error, showToast),
        shouldResync: () => isLatestCommit() && !!options.refreshAfter,
        resync: () => refreshDomEditSelectionFromPreview(selection),
        onSettled: options.onSettled,
      });
    },
    [
      activeCompPath,
      persistDomEditOperations,
      refreshDomEditSelectionFromPreview,
      showToast,
      previewIframeRef,
    ],
  );

  const handleDomAttributesCommit = useCallback(
    async (selection: DomEditSelection, attrs: Record<string, string>) => {
      await commitDataAttributes(selection, attrs, {
        label: "Edit timing",
        coalescePrefix: "attrs",
        skipRefresh: false,
        refreshAfter: true,
      });
    },
    [commitDataAttributes],
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
    async (attr: string, value: string | null, onSettled?: (ok: boolean) => void) => {
      await commitDataAttribute(attr, value, {
        label: `Edit ${attr.replace(/^(data-)?/, "").replace(/-/g, " ")}`,
        coalescePrefix: "attr-live",
        skipRefresh: true,
        onSettled,
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
    handleDomAttributesCommit,
  };
}
