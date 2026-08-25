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
import { syncStoredAutomationFromPreview } from "../player/lib/automationStoreSync";
import { HF_AUDIO_GROUP_ATTR, HF_AUDIO_GROUP_TAG } from "@hyperframes/core/audio-groups";
import { invalidateGroupInfoCache } from "../player/lib/timelineGroupInfo";

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
  /**
   * Undo grouping for a gesture that spans several commits.
   *
   * Without it the key is derived from the prefix, attribute and element, and the
   * window is history's own 300ms — so a drag's moves and the release that ends it
   * landed in different entries, and a drag slower than the window split further.
   * A caller that knows a gesture is in progress passes one key for all of it.
   */
  coalesce?: { key: string; ms: number };
  /**
   * Apply to the preview and stop there — no file write, no history entry.
   *
   * What a gesture wants from every pointermove: the preview document and the
   * audio graph following the pointer, with the file written once on release.
   * Persisting each move put a fragment of one drag in the undo stack, and since
   * those writes race, a follow-up's "before" was often not the previous entry's
   * "after" — history refuses to coalesce across that gap, so undo took back a
   * few milliseconds of the gesture and looked like it had done nothing.
   */
  previewOnly?: boolean;
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
  // Every DOM-edit attribute write funnels through here, which is the only
  // place that can catch a group edit made from the rack rather than from the
  // group header — `openGroupFxRack` hands the `<hf-audio-group>` to the DOM
  // editor, and that path never went near the timeline's own writers.
  //
  // The group element itself OR a member's membership attribute: writing
  // `data-audio-group` onto an `<audio>` moves it between groups, which changes
  // the answer just as much as editing the bus does.
  if (el.tagName.toLowerCase() === HF_AUDIO_GROUP_TAG || fullAttr === HF_AUDIO_GROUP_ATTR) {
    invalidateGroupInfoCache(el.ownerDocument);
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
      const commitKey =
        options.coalesce?.key ??
        `${options.coalescePrefix}:${attr}:${getDomEditTargetKey(domEditSelection)}`;
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
        persist: options.previewOnly
          ? async () => {}
          : () =>
              persistDomEditOperations(domEditSelection, [op], {
                label: options.label,
                coalesceKey: commitKey,
                ...(options.coalesce ? { coalesceMs: options.coalesce.ms } : {}),
                skipRefresh: options.skipRefresh,
              }),
        shouldRevert: () => isLatestCommit(),
        revert: () => {
          if (!editedElement) return;
          setOrRemovePreviewAttribute(editedElement, fullAttr, previousValue);
        },
        onError: (error) => reportDomEditPersistFailure(domEditSelection, [op], error, showToast),
        shouldResync: () => isLatestCommit() && !!options.refreshAfter,
        resync: () => {
          refreshDomEditSelectionFromPreview(domEditSelection);
          // The player store keeps its own copy of each element's attributes, and
          // that copy is what the timeline's automation lanes draw from. Nothing
          // else refreshes it: a commit patches the preview document and the file,
          // and resyncs the dom-edit SELECTION for the panel. So every writer that
          // did not also update the store by hand — the FX panel's automate and
          // un-automate buttons, the keyboard Delete, a paste — changed the file and
          // the audio while the lane went on drawing what it had, until a reload.
          // One sink here rather than a sync in each writer, because three of them
          // shipped without one.
          syncStoredAutomationFromPreview(previewIframeRef.current?.contentDocument ?? null);
        },
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
    async (
      attr: string,
      value: string | null,
      onSettled?: (ok: boolean) => void,
      live?: { coalesce?: { key: string; ms: number }; previewOnly?: boolean },
    ) => {
      await commitDataAttribute(attr, value, {
        label: `Edit ${attr.replace(/^(data-)?/, "").replace(/-/g, " ")}`,
        coalescePrefix: "attr-live",
        skipRefresh: true,
        onSettled,
        ...(live?.coalesce ? { coalesce: live.coalesce } : {}),
        ...(live?.previewOnly ? { previewOnly: true } : {}),
      });
    },
    [commitDataAttribute],
  );

  /**
   * Persist without reloading the preview, but re-read the selection afterwards.
   *
   * For attributes the runtime applies to the live graph itself — an audio FX
   * chain, its automation — a reload would only interrupt playback to reach the
   * state the preview already has. The resync is still needed: without it the
   * panel keeps reading the selection snapshot it was built with, so a second
   * edit computes from a pre-edit value and appears to do nothing.
   */
  const handleDomAttributeQuietCommit = useCallback(
    async (attr: string, value: string | null, coalesce?: { key: string; ms: number }) => {
      await commitDataAttribute(attr, value, {
        label: `Edit ${attr.replace(/^(data-)?/, "").replace(/-/g, " ")}`,
        coalescePrefix: "attr-quiet",
        skipRefresh: true,
        refreshAfter: true,
        ...(coalesce ? { coalesce } : {}),
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
        resync: () => {
          refreshDomEditSelectionFromPreview(domEditSelection);
          // The player store keeps its own copy of each element's attributes, and
          // that copy is what the timeline's automation lanes draw from. Nothing
          // else refreshes it: a commit patches the preview document and the file,
          // and resyncs the dom-edit SELECTION for the panel. So every writer that
          // did not also update the store by hand — the FX panel's automate and
          // un-automate buttons, the keyboard Delete, a paste — changed the file and
          // the audio while the lane went on drawing what it had, until a reload.
          // One sink here rather than a sync in each writer, because three of them
          // shipped without one.
          syncStoredAutomationFromPreview(previewIframeRef.current?.contentDocument ?? null);
        },
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
    handleDomAttributeQuietCommit,
    handleDomHtmlAttributeCommit,
    handleDomAttributesCommit,
  };
}
