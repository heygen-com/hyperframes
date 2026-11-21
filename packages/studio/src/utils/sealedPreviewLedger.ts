// Which late answers from a sealed preview may still act: one record per preview load.
import type { EditingPortClient } from "@hyperframes/core/runtime/editing-port";
import { previewEditingClient } from "../player/lib/previewChannel";
import { studioFileRevision } from "./studioFileVersion";
import { timelineKeys } from "@hyperframes/core/runtime/soft-reload";

/** A saved file state a re-run can show: the script and the files it was read with. */
export interface PreviewWrite {
  scriptText: string;
  authoredHtml?: string;
  previousHtml?: string;
  nestedFiles?: Map<string, string> | null;
  timingEdit?: boolean;
}

export interface PreviewTicket {
  readonly iframe: HTMLIFrameElement;
  readonly load: EditingPortClient;
  readonly keys: readonly string[];
  readonly seq: number;
  /** The Studio file version its write produced: a re-run read at a lower one lacks it. */
  readonly version: number;
  readonly write: PreviewWrite;
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

/** Records a write sent to the preview; `rerun` when it re-runs the timelines it names (it then owns them). */
export function takePreviewTicket(
  iframe: HTMLIFrameElement,
  write: PreviewWrite,
  rerun: boolean,
): PreviewTicket {
  const load = previewEditingClient(iframe);
  const ledger = ledgerOf(load);
  const ticket = {
    iframe,
    load,
    keys: timelineKeys(write.scriptText),
    seq: ++ledger.seq,
    version: studioFileRevision(),
    write,
  };
  for (const key of ticket.keys) ledger.writes.set(key, { seq: ticket.seq, write });
  if (rerun) confirmPreviewRerun(ticket);
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
export function ticketCovered(ticket: PreviewTicket): boolean {
  const { reruns } = ledgerOf(ticket.load);
  return (
    ticket.keys.length > 0 &&
    ticket.keys.every((key) => {
      const owner = reruns.get(key);
      return owner !== undefined && owner.seq > ticket.seq && owner.version >= ticket.version;
    })
  );
}

/** The newest saved state sent for the ticket's timelines; it holds every earlier saved change. */
export function newestPreviewWrite(ticket: PreviewTicket): PreviewWrite {
  const { writes } = ledgerOf(ticket.load);
  let newest = { seq: ticket.seq, write: ticket.write };
  for (const key of ticket.keys) {
    const sent = writes.get(key);
    if (sent && sent.seq > newest.seq) newest = sent;
  }
  return newest.write;
}

/** A late failure acts only for the live load and only when no later re-run carries its change. */
export function ticketNeedsRecovery(ticket: PreviewTicket): boolean {
  return ticketLoadLive(ticket) && !ticketCovered(ticket);
}
