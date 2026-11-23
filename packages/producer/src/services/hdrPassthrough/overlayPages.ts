/**
 * HDR passthrough: the capture options of the passthrough's own pages, so
 * that neither changes what the layered path's DOM session does after a
 * fallback, and the capture page loads as that session would.
 *
 * The passthrough opens two pages. The analysis page runs eligibility: the
 * gates, the video layout samples and the timing analysis, which seek all
 * over the composition. Seeks leave browser state behind that no later seek
 * undoes (a scroll offset a shorter layout clamped, a lazy image loaded and
 * the promise reaction its decode ran), so capture never runs on that page.
 * The capture page is opened fresh once eligibility passes and walks the
 * frames in order, as the layered loop does (`overlayCapture.ts`), after the
 * same steps the layered DOM session takes before frame 0 (`index.ts`).
 *
 * A render's capture sessions share state through their options, and the
 * first session to reach it changes what the later ones do:
 *
 * - `recordReferenceBackground` reads the page background once per render;
 *   the read seeks the page to 0. Whichever session asks first runs it, and
 *   every later session skips it. A passthrough page that asked first took
 *   that seek away from the layered DOM session after a fallback, so a page
 *   that counts its seeks rendered one fewer before frame 0 than with the
 *   flag off. The analysis page never reads it. The capture page runs the
 *   read exactly when the layered session would have (no session has asked
 *   yet), keeps the value to itself, and hands it to the render's recorder
 *   only once the passthrough completes, when the layered session never runs.
 * - `subTimelineWaitMemo` and `staticDedupMemo` let a session skip a wait or a
 *   check an earlier one did. Each passthrough page gets copies: it sees what
 *   the layered session would see, and what it adds stays its own.
 */

import type {
  CaptureOptions,
  ReferenceBackground,
  ReferenceBackgroundRecorder,
} from "@hyperframes/engine";

type RecordReferenceBackground = NonNullable<CaptureOptions["recordReferenceBackground"]>;

/** The capture page's stand-in for the render's reference background recorder. */
export interface ReferenceBackgroundMirror {
  /** For the capture page's options: reads when the layered session would, records nothing. */
  readonly recordOnPage: CaptureOptions["recordReferenceBackground"];
  /** Records what the capture page read with the render's recorder; once the passthrough completes. */
  commit(): Promise<void>;
}

function isRecorder(record: RecordReferenceBackground): record is ReferenceBackgroundRecorder {
  return typeof (record as Partial<ReferenceBackgroundRecorder>).started === "boolean";
}

/**
 * Mirror the render's recorder on the capture page. Throws when the
 * recorder cannot say whether a session has read already (not one
 * `createReferenceBackgroundRecorder` made): the passthrough then cannot
 * load its page as the layered session would, and falls back.
 */
export function mirrorReferenceBackground(
  record: CaptureOptions["recordReferenceBackground"],
): ReferenceBackgroundMirror {
  if (record === undefined) return { recordOnPage: undefined, commit: async () => undefined };
  if (!isRecorder(record)) {
    throw new Error("hdrPassthrough: the render's reference background recorder is not shareable");
  }
  let read: ReferenceBackground | undefined;
  return {
    async recordOnPage(readPage) {
      if (record.started) return;
      read = await readPage().catch((): ReferenceBackground => ({ kind: "unknown" }));
    },
    async commit() {
      const value = read;
      if (value !== undefined) await record(async () => value);
    },
  };
}

/**
 * Capture options for a passthrough page: the render's own, with private
 * copies of the shared memos and `recordReferenceBackground` replaced
 * (`undefined` for the analysis page, a mirror's `recordOnPage` for the
 * capture page).
 */
export function overlayPageOptions(
  options: CaptureOptions,
  recordReferenceBackground: CaptureOptions["recordReferenceBackground"],
): CaptureOptions {
  const waits = options.subTimelineWaitMemo;
  const dedup = options.staticDedupMemo;
  return {
    ...options,
    recordReferenceBackground,
    ...(waits
      ? {
          subTimelineWaitMemo: {
            ...waits,
            ...(waits.loggedSceneCallbackErrors
              ? { loggedSceneCallbackErrors: [...waits.loggedSceneCallbackErrors] }
              : {}),
          },
        }
      : {}),
    ...(dedup ? { staticDedupMemo: dedup.checks ? { checks: new Map(dedup.checks) } : {} } : {}),
  };
}
