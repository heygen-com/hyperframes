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

export interface PreviewSend {
  scriptText: string;
  snapshot: PreviewWrite | null;
  /** It re-runs its timelines, so it owns them from its send. */
  rerun: boolean;
  /** It carries restored attributes: refused by the frame, no later script-only re-run sends them again. */
  attributes: boolean;
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
  reruns: Map<string, { seq: number; version: number }>;
  writes: Map<string, { seq: number; write: PreviewWrite }>;
}

const ledgers = new WeakMap<EditingPortClient, Ledger>();

function ledgerOf(load: EditingPortClient): Ledger {
  let ledger = ledgers.get(load);
  if (!ledger) ledgers.set(load, (ledger = { seq: 0, reruns: new Map(), writes: new Map() }));
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
  if (sent.snapshot)
    for (const key of ticket.keys)
      ledger.writes.set(key, { seq: ticket.seq, write: sent.snapshot });
  if (sent.rerun) confirmPreviewRerun(ticket);
  return ticket;
}

/** The frame re-ran the ticket's timelines; it owns them from its send order, never a later owner's. */
export function confirmPreviewRerun(ticket: PreviewTicket): void {
  const { reruns } = ledgerOf(ticket.load);
  for (const key of ticket.keys) {
    const owner = reruns.get(key);
    if (!owner || owner.seq < ticket.seq)
      reruns.set(key, { seq: ticket.seq, version: ticket.version });
  }
}

/** An answer from a load that has since been replaced must not touch its replacement. */
export function ticketLoadLive(ticket: PreviewTicket): boolean {
  return previewEditingClient(ticket.iframe) === ticket.load;
}

/** A later re-run read at this version or newer carries this write's change and owns its recovery. */
export function ticketCovered(ticket: PreviewTicket, refused = false): boolean {
  const { reruns } = ledgerOf(ticket.load);
  return (
    !(refused && ticket.sent.attributes) &&
    ticket.keys.length > 0 &&
    ticket.keys.every((key) => {
      const owner = reruns.get(key);
      return owner !== undefined && owner.seq > ticket.seq && owner.version >= ticket.version;
    })
  );
}

/** The newest complete saved state sent for the ticket's timelines; it holds every earlier saved change. */
export function newestPreviewWrite(ticket: PreviewTicket): PreviewWrite | null {
  const { writes } = ledgerOf(ticket.load);
  let newest = { seq: ticket.seq, write: ticket.sent.snapshot };
  for (const key of ticket.keys) {
    const sent = writes.get(key);
    if (sent && sent.seq > newest.seq) newest = sent;
  }
  return newest.write;
}

/** A late failure acts only for the live load and only when no later re-run carries its change. */
export function ticketNeedsRecovery(ticket: PreviewTicket, refused = false): boolean {
  return ticketLoadLive(ticket) && !ticketCovered(ticket, refused);
}
