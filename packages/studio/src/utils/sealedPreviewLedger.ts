// Which late answers from a sealed preview may still act: one record per preview load.
import type {
  EditingParams,
  EditingPortClient,
  EditingRequestKind,
} from "@hyperframes/core/runtime/editing-port";
import {
  previewAnswer,
  previewEditingClient,
  previewFrameOpaque,
} from "../player/lib/previewChannel";
import { studioFileRevision } from "./studioFileVersion";
import { timelineKeys } from "@hyperframes/core/runtime/soft-reload";

/** A complete saved file state a re-run can show: the script, both files it was read from, and its timing. */
export interface PreviewWrite {
  scriptText: string;
  authoredHtml: string;
  previousHtml: string;
  nestedFiles?: Map<string, string> | null;
  timingEdit?: boolean;
  version?: number;
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
  /** A script re-run: it owns its timelines from its send. */
  rerun?: boolean;
  version?: number;
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

type Owner = { seq: number; version: number };

interface Ledger {
  seq: number;
  reruns: Map<string, Owner>;
  /** Kept apart: a later script-only re-run leaves the timing an earlier one applied in place. */
  timedReruns: Map<string, Owner>;
  writes: Map<string, { seq: number; version: number; write: PreviewWrite }>;
  newestVersion: number;
  /** The newest saved file version sent to this load. */
  sentVersion: number;
}

const ledgers = new WeakMap<EditingPortClient, Ledger>();

function ledgerOf(load: EditingPortClient): Ledger {
  let ledger = ledgers.get(load);
  if (!ledger)
    ledgers.set(
      load,
      (ledger = {
        seq: 0,
        reruns: new Map(),
        timedReruns: new Map(),
        writes: new Map(),
        newestVersion: 0,
        sentVersion: 0,
      }),
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
    version: sent.snapshot?.version ?? sent.version ?? studioFileRevision(),
    sent,
  };
  ledger.newestVersion = Math.max(ledger.newestVersion, ticket.version);
  if (sent.snapshot) {
    const write = { seq: ticket.seq, version: ticket.version, write: sent.snapshot };
    for (const key of ticket.keys) {
      const kept = ledger.writes.get(key);
      if (!kept || newer(write, kept)) ledger.writes.set(key, write);
    }
  }
  return ticket;
}

/** A later saved file wins; of one file's writes, the later sent. */
function newer(a: { seq: number; version: number }, b: { seq: number; version: number }) {
  return a.version > b.version || (a.version === b.version && a.seq > b.seq);
}

/** A re-run owns its timelines from its send: it applies, or it fails and recovers to the newest file itself. */
export function confirmPreviewRerun(ticket: PreviewTicket): void {
  const { reruns, timedReruns } = ledgerOf(ticket.load);
  const owner = { seq: ticket.seq, version: ticket.version };
  for (const owners of ticket.sent.timing ? [reruns, timedReruns] : [reruns])
    for (const key of ticket.keys) {
      const current = owners.get(key);
      if (!current || newer(owner, current)) owners.set(key, owner);
    }
}

/** Every sealed write's one send: once the frame can take it, a write older than a file already sent there is not. */
export function sendPreviewWrite<K extends EditingRequestKind>(
  ticket: PreviewTicket,
  kind: K,
  params: EditingParams<K>,
  timeoutMs?: number,
) {
  return previewAnswer(ticket.iframe, kind, params, timeoutMs, () => {
    const ledger = ledgerOf(ticket.load);
    if (ticket.version < ledger.sentVersion) return false;
    ledger.sentVersion = ticket.version;
    if (ticket.sent.rerun) confirmPreviewRerun(ticket);
    return true;
  });
}

/** The load now in `iframe` shows the saved file at `revision`: an older write is not sent to it. */
export function previewLoadShows(iframe: HTMLIFrameElement, revision: number): void {
  if (!previewFrameOpaque(iframe)) return;
  const ledger = ledgerOf(previewEditingClient(iframe));
  ledger.sentVersion = Math.max(ledger.sentVersion, revision);
  ledger.newestVersion = Math.max(ledger.newestVersion, revision);
}

/** An answer from a load that has since been replaced must not touch its replacement. */
export function ticketLoadLive(ticket: PreviewTicket): boolean {
  return previewEditingClient(ticket.iframe) === ticket.load;
}

/** A later re-run read at this version or newer carries everything this write changed. */
function ticketCovered(ticket: PreviewTicket): boolean {
  const { reruns, timedReruns } = ledgerOf(ticket.load);
  const owners = ticket.sent.timing ? timedReruns : reruns;
  return (
    !ticket.sent.attributes &&
    ticket.keys.length > 0 &&
    ticket.keys.every((key) => {
      const owner = owners.get(key);
      if (!owner) return false;
      return (
        owner.version > ticket.version ||
        (owner.seq > ticket.seq && owner.version >= ticket.version)
      );
    })
  );
}

/** The newest saved state for the ticket's timelines, with timing; null when a newer file was sent without one. */
export function newestPreviewWrite(ticket: PreviewTicket): PreviewWrite | null {
  const { writes, newestVersion } = ledgerOf(ticket.load);
  let newest = { seq: ticket.seq, version: ticket.version, write: ticket.sent.snapshot };
  for (const key of ticket.keys) {
    const sent = writes.get(key);
    if (sent && newer(sent, newest)) newest = sent;
  }
  if (!newest.write || newest.version < newestVersion) return null;
  return { ...newest.write, version: newest.version, timingEdit: true };
}

/** A late failure acts only for the live load and only when no later re-run carries its change. */
export function ticketNeedsRecovery(ticket: PreviewTicket): boolean {
  return ticketLoadLive(ticket) && !ticketCovered(ticket);
}
