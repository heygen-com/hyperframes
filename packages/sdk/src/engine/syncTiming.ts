import {
  findSyncPartner,
  moveIntoSyncStart,
  readLinkTiming,
  slipIntoSyncMediaStart,
  syncOffsetFrames,
} from "@hyperframes/core/media-link";
import type { HfId } from "../types.js";
import { resolveScoped } from "./model.js";

export type SyncFix =
  | { kind: "move"; start: number }
  | { kind: "slip"; name: "data-media-start" | "data-playback-start"; value: string };

function pairOf(document: Document, id: HfId): { own: Element; partner: Element } | null {
  const own = resolveScoped(document, id);
  const partner = own ? findSyncPartner(own) : null;
  return own && partner ? { own, partner } : null;
}

/** Frames `id` sits from its source partner; null when unpaired or at another rate. */
export function syncOffsetOf(document: Document, id: HfId, fps: number): number | null {
  const pair = pairOf(document, id);
  if (!pair) return null;
  return syncOffsetFrames(readLinkTiming(pair.own), readLinkTiming(pair.partner), fps);
}

const formatSeconds = (value: number) => String(Number(value.toFixed(6)));

/** The one attribute write that brings `id` back into sync, by moving or slipping it. */
export function syncFixFor(document: Document, id: HfId, mode: "move" | "slip"): SyncFix {
  const pair = pairOf(document, id);
  if (!pair) throw new Error(`${id} has no source partner (data-sync-origin)`);
  const own = readLinkTiming(pair.own);
  const partner = readLinkTiming(pair.partner);
  if (syncOffsetFrames(own, partner, 1000) === null) {
    throw new Error(`${id} and its partner play at different rates; no single sync exists`);
  }
  if (mode === "move") {
    const start = moveIntoSyncStart(own, partner);
    if (start === null) throw new Error(`moving ${id} into sync would put it before 0`);
    return { kind: "move", start: Number(start.toFixed(6)) };
  }
  const mediaStart = slipIntoSyncMediaStart(own, partner);
  if (mediaStart === null) throw new Error(`slipping ${id} into sync would start before its file`);
  const legacy =
    !pair.own.hasAttribute("data-media-start") && pair.own.hasAttribute("data-playback-start");
  const name = legacy ? "data-playback-start" : "data-media-start";
  return { kind: "slip", name, value: formatSeconds(mediaStart) };
}
