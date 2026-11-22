import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import {
  HF_COLOR_GRADING_ATTR,
  hasHfColorGradingAuthoredValues,
  serializeHfColorGrading,
  type NormalizedHfColorGrading,
} from "@hyperframes/core/color-grading";
import {
  addStudioPendingEditFlushListener,
  trackStudioPendingEdit,
} from "../../utils/studioPendingEdits";
import { bumpDomEditCommitVersion } from "../../hooks/domEditCommitRunner";

export const COLOR_GRADING_DATA_KEY = HF_COLOR_GRADING_ATTR.replace(/^data-/, "");
const PERSIST_DELAY_MS = 350;

type SetAttribute = (
  attr: string,
  value: string | null,
  onSettled?: (ok: boolean) => void,
) => void | Promise<void>;

/** Saves each committed grade once edits pause, reverting to the last saved grade when a save fails. */
export function useColorGradingPersistence({
  identityKey,
  identityKeyRef,
  latestGradingRef,
  confirmedGradingRef,
  onSetAttributeQuiet,
  onSaveFailed,
}: {
  identityKey: string;
  identityKeyRef: MutableRefObject<string>;
  latestGradingRef: MutableRefObject<NormalizedHfColorGrading>;
  confirmedGradingRef: MutableRefObject<NormalizedHfColorGrading>;
  onSetAttributeQuiet: SetAttribute;
  onSaveFailed: (reverted: NormalizedHfColorGrading) => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValueRef = useRef<string | null | undefined>(undefined);
  const pendingGradingRef = useRef<NormalizedHfColorGrading | null>(null);
  // Capture the edited element because selection can change before persistence.
  const pendingIdentityRef = useRef<string | null>(null);
  // Prevent an older same-element write from settling over a newer edit.
  const versionRef = useRef(0);
  const onSaveFailedRef = useRef(onSaveFailed);
  onSaveFailedRef.current = onSaveFailed;

  const takePending = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = {
      value: pendingValueRef.current,
      grading: pendingGradingRef.current,
      identity: pendingIdentityRef.current,
    };
    pendingValueRef.current = undefined;
    pendingGradingRef.current = null;
    pendingIdentityRef.current = null;
    return pending;
  };

  const persist = useCallback(
    (
      value: string | null,
      attemptedGrading: NormalizedHfColorGrading,
      attemptIdentityKey: string,
      isLatestAttempt: () => boolean,
    ) => {
      const applySettled = (ok: boolean) => {
        if (identityKeyRef.current !== attemptIdentityKey) return;
        if (!isLatestAttempt()) return;
        if (ok) {
          confirmedGradingRef.current = attemptedGrading;
          return;
        }
        onSaveFailedRef.current(confirmedGradingRef.current);
      };
      // The callback is the primary result signal; the rejection path supports
      // other setter implementations.
      const result = onSetAttributeQuiet(COLOR_GRADING_DATA_KEY, value, applySettled);
      return trackStudioPendingEdit(
        Promise.resolve(result).then(
          () => undefined,
          () => applySettled(false),
        ),
      );
    },
    [confirmedGradingRef, identityKeyRef, onSetAttributeQuiet],
  );

  const flushPendingPersist = useCallback(() => {
    const pending = takePending();
    if (pending.value === undefined) return undefined;
    return persist(
      pending.value,
      pending.grading ?? latestGradingRef.current,
      pending.identity ?? identityKeyRef.current,
      bumpDomEditCommitVersion(versionRef),
    );
  }, [identityKeyRef, latestGradingRef, persist]);

  const schedulePersist = useCallback(
    (nextGrading: NormalizedHfColorGrading) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingValueRef.current = hasHfColorGradingAuthoredValues(nextGrading)
        ? serializeHfColorGrading(nextGrading)
        : null;
      pendingGradingRef.current = nextGrading;
      pendingIdentityRef.current = identityKeyRef.current;
      const attemptIdentityKey = identityKeyRef.current;
      const isLatestAttempt = bumpDomEditCommitVersion(versionRef);
      timerRef.current = setTimeout(() => {
        const pending = takePending();
        void persist(
          pending.value ?? null,
          pending.grading ?? nextGrading,
          attemptIdentityKey,
          isLatestAttempt,
        );
      }, PERSIST_DELAY_MS);
    },
    [identityKeyRef, persist],
  );

  const isPersistPending = useCallback(() => pendingValueRef.current !== undefined, []);

  // Flush a pending write through the outgoing selection's committed callback.
  useEffect(() => {
    return () => {
      const pending = takePending();
      if (pending.value === undefined) return;
      trackStudioPendingEdit(onSetAttributeQuiet(COLOR_GRADING_DATA_KEY, pending.value));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identityKey is the intended trigger; see comment above
  }, [identityKey]);

  useEffect(() => addStudioPendingEditFlushListener(flushPendingPersist), [flushPendingPersist]);
  useEffect(() => () => void flushPendingPersist(), [flushPendingPersist]);

  return { schedulePersist, flushPendingPersist, isPersistPending };
}
