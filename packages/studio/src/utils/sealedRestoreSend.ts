// Sends an undo's restore to a sealed preview; a restore the frame does not apply reloads it.
import type { EditingParams } from "@hyperframes/core/runtime/editing-port";
import {
  SAVED_STATE_DEADLINE_MS,
  confirmPreviewRerun,
  sendPreviewWrite,
  takePreviewTicket,
  ticketLoadLive,
  type PreviewWrite,
} from "./sealedPreviewLedger";

export type SealedRestore = Omit<EditingParams<"restore-attributes">, "time">;

/** The restored file as a complete snapshot, when the restore re-runs its script. */
export function restoredSnapshot(
  { rerun }: SealedRestore,
  active: { restored: string; previous: string } | undefined,
  version: number | undefined,
): PreviewWrite | null {
  if (!rerun || !active) return null;
  const { restored: authoredHtml, previous: previousHtml } = active;
  return { scriptText: rerun.script, authoredHtml, previousHtml, version };
}

export function sendSealedRestore(
  iframe: HTMLIFrameElement,
  {
    sent: restore,
    snapshot,
    version,
  }: { sent: SealedRestore; snapshot: PreviewWrite | null; version?: number },
  currentTime: number,
  reloadPreview: () => void,
  onShownInPlace?: () => void,
): void {
  const scriptText = restore.rerun?.script ?? "";
  const ticket = takePreviewTicket(iframe, {
    scriptText,
    snapshot,
    attributes: true,
    timing: false,
    version,
  });
  const params = { ...restore, time: currentTime };
  void sendPreviewWrite(ticket, "restore-attributes", params, SAVED_STATE_DEADLINE_MS).then(
    (answer) => {
      if (!ticketLoadLive(ticket)) return;
      const reply = typeof answer === "object" ? answer : null;
      // Refused or stale: its attributes are not on screen, and a newer re-run does not set them.
      if (!reply?.applied) return reloadPreview();
      if (reply.reran === true) confirmPreviewRerun(ticket);
      onShownInPlace?.();
    },
  );
}
