// Which late answers from a sealed preview may still act: one record per preview load.
import type { EditingPortClient } from "@hyperframes/core/runtime/editing-port";
import { previewEditingClient } from "../player/lib/previewChannel";
import { studioFileRevision } from "./studioFileVersion";
import { timelineKeys } from "@hyperframes/core/runtime/soft-reload";

/** A complete saved file state a re-run can show: the script, both files it was read from, and its timing. */
export interface PreviewWrite {
  scriptText: string;
  authoredHtml: string;
  previousHtml: string;
  nestedFiles?: Map<string, string> | null;
  timingEdit?: boolean;
}

/** How long a write carrying restored attributes or clip timing waits for the frame before it recovers. */
export const SAVED_STATE_DEADLINE_MS = 30_000;

export interface PreviewSend {
  scriptText: string;
  snapshot: PreviewWrite | null;
  /** Restored attributes: no other write sends them again, so nothing covers them. */
  attributes: boolean;
  /** Clip timing: covered only by a newer re-run that carried the saved timing too. */
  timing: boolean;
}

export interface PreviewTicket {
  readonly iframe: HTMLIFrameElement;
  readonly load: EditingPortClient;
  readonly keys: readonly string[];
  readonly seq: number;
  /** The Studio file version its write produced: a re-run read at a lower one lacks it. */
  readonly version: number;
  readonly sent: PreviewSend;
}

interface Ledger {
  seq: number;
  reruns: Map<string, { seq: number; version: number; timing: boolean }>;
  writes: Map<string, { seq: number; version: number; write: PreviewWrite }>;
  newestVersion: number;
}

const ledgers = new WeakMap<EditingPortClient, Ledger>();

function ledgerOf(load: EditingPortClient): Ledger {
  let ledger = ledgers.get(load);
  if (!ledger)
    ledgers.set(
      load,
      (ledger = { seq: 0, reruns: new Map(), writes: new Map(), newestVersion: 0 }),
    );
  return ledger;
}

export function takePreviewTicket(iframe: HTMLIFrameElement, sent: PreviewSend): PreviewTicket {
  const load = previewEditingClient(iframe);
  const ledger = ledgerOf(load);
  const ticket = {
    iframe,
    load,
    keys: timelineKeys(sent.scriptText),
    seq: ++ledger.seq,
    version: studioFileRevision(),
    sent,
  };
  ledger.newestVersion = Math.max(ledger.newestVersion, ticket.version);
  if (sent.snapshot)
    for (const key of ticket.keys)
      ledger.writes.set(key, { seq: ticket.seq, version: ticket.version, write: sent.snapshot });
  return ticket;
}

/** A re-run owns its timelines from its send: it applies, or it fails and recovers to the newest file itself. */
export function confirmPreviewRerun(ticket: PreviewTicket): void {
  const { reruns } = ledgerOf(ticket.load);
  const owner = { seq: ticket.seq, version: ticket.version, timing: ticket.sent.timing };
  for (const key of ticket.keys) {
    const current = reruns.get(key);
    if (!current || current.seq < ticket.seq) reruns.set(key, owner);
  }
}

/** An answer from a load that has since been replaced must not touch its replacement. */
export function ticketLoadLive(ticket: PreviewTicket): boolean {
  return previewEditingClient(ticket.iframe) === ticket.load;
}

/** A later re-run read at this version or newer carries everything this write changed. */
function ticketCovered(ticket: PreviewTicket): boolean {
  const { reruns } = ledgerOf(ticket.load);
  return (
    !ticket.sent.attributes &&
    ticket.keys.length > 0 &&
    ticket.keys.every((key) => {
      const owner = reruns.get(key);
      if (!owner || owner.seq <= ticket.seq || owner.version < ticket.version) return false;
      return owner.timing || !ticket.sent.timing;
    })
  );
}

/** The newest saved state for the ticket's timelines, with timing; null when a newer file was sent without one. */
export function newestPreviewWrite(ticket: PreviewTicket): PreviewWrite | null {
  const { writes, newestVersion } = ledgerOf(ticket.load);
  let newest = { seq: ticket.seq, version: ticket.version, write: ticket.sent.snapshot };
  for (const key of ticket.keys) {
    const sent = writes.get(key);
    if (sent && sent.seq > newest.seq) newest = sent;
  }
  if (!newest.write || newest.version < newestVersion) return null;
  return { ...newest.write, timingEdit: true };
}

/** A late failure acts only for the live load and only when no later re-run carries its change. */
export function ticketNeedsRecovery(ticket: PreviewTicket): boolean {
  return ticketLoadLive(ticket) && !ticketCovered(ticket);
}
