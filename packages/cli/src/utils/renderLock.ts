import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { hyperframesCacheDir } from "@hyperframes/core/cache-dir";
import { processIdentity } from "./orphanCleanup.js";
import { alive, readHolder, release, takeOver, tryAcquire, type Holder } from "./projectLock.js";
import { liveOtherOwners, removeIfPresent, writeOwnerMarker } from "./renderLockOwners.js";

/** Who holds this user account's render slot. */
export interface RenderLockHolder extends Holder {
  project: string;
}

export class RenderLockBusy extends Error {
  constructor(
    readonly holder: RenderLockHolder | null,
    readonly path: string,
  ) {
    super(`Another render is running (${describeRenderLockHolder(holder, Date.now())})`);
    this.name = "RenderLockBusy";
  }
}

export interface RenderLockOptions {
  project: string;
  /** False: fail at once with {@link RenderLockBusy} instead of waiting for the slot. */
  wait: boolean;
  signal?: AbortSignal;
  /** Called once per holder this render starts waiting behind. */
  onWait?: (holder: RenderLockHolder | null, path: string) => void;
  path?: string;
  pollMs?: number;
  env?: NodeJS.ProcessEnv;
  pid?: number;
  claim?: (path: string, holder: Holder) => boolean | Promise<boolean>;
}

const POLL_MS = 1_000;

const renderLockPath = () => hyperframesCacheDir("locks", "render.lock");

/** `HYPERFRAMES_RENDER_LOCK=off` lets this account's renders run side by side. */
function renderLockDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.HYPERFRAMES_RENDER_LOCK?.trim().toLowerCase();
  return value === "off" || value === "0" || value === "false";
}

export function describeRenderLockHolder(holder: RenderLockHolder | null, now: number): string {
  if (!holder) return "holder unknown";
  const seconds = Math.max(0, Math.round((now - holder.startedAt) / 1000));
  const running = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  return `pid ${holder.pid}, project ${holder.project}, running ${running}`;
}

function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Claims a lock or `.break` only a dead writer could have left: unreadable ones need no live contender. */
function reclaimAbandoned(path: string, holder: Holder, marker: string): boolean {
  const current = readHolder(path);
  if (current && alive(current.pid)) return false;
  const breakPath = `${path}.break`;
  if (existsSync(breakPath)) {
    const breaker = readHolder(breakPath);
    if (breaker ? alive(breaker.pid) : liveOtherOwners(path, marker) > 0) return false;
    removeIfPresent(breakPath);
    return tryAcquire(path, holder);
  }
  const writerGone = () =>
    existsSync(path) && !readHolder(path) && liveOtherOwners(path, marker) === 0;
  return writerGone() && takeOver(path, holder, writerGone);
}

const sameWaitTarget = (a: RenderLockHolder | null, b: RenderLockHolder | null) =>
  a?.pid === b?.pid && a?.startedAt === b?.startedAt;

/**
 * Takes the one render slot of this user account (its HyperFrames cache folder), waiting while a live
 * process holds it; a holder whose process is gone is taken over. Returns the release.
 */
export async function acquireRenderLock(options: RenderLockOptions): Promise<() => void> {
  if (renderLockDisabled(options.env)) return () => {};
  const contender = prepareContender(options);
  let waitingBehind: RenderLockHolder | null | undefined;
  for (;;) {
    const releaseSlot = await claimOnce(contender);
    if (releaseSlot) return releaseSlot;
    const { path } = contender;
    const current = readHolder<RenderLockHolder>(path);
    if (!current && !existsSync(path)) continue;
    if (!options.wait) throw new RenderLockBusy(current, path);
    if (waitingBehind === undefined || !sameWaitTarget(waitingBehind, current)) {
      waitingBehind = current;
      options.onWait?.(current, path);
    }
    await pause(options.pollMs ?? POLL_MS, options.signal);
  }
}

interface Contender {
  path: string;
  holder: RenderLockHolder;
  owner: { pid: number; identity: string | null };
  claim: NonNullable<RenderLockOptions["claim"]>;
}

function prepareContender(options: RenderLockOptions): Contender {
  const path = options.path ?? renderLockPath();
  mkdirSync(dirname(path), { recursive: true });
  liveOtherOwners(path);
  const pid = options.pid ?? process.pid;
  return {
    path,
    holder: { pid, command: "render", startedAt: Date.now(), project: options.project },
    owner: { pid, identity: processIdentity(pid) },
    claim: options.claim ?? tryAcquire,
  };
}

async function claimOnce({ path, holder, owner, claim }: Contender): Promise<(() => void) | null> {
  const marker = writeOwnerMarker(path, owner);
  let held = false;
  try {
    held = (await claim(path, holder)) || reclaimAbandoned(path, holder, marker);
  } finally {
    if (!held) removeIfPresent(marker);
  }
  if (!held) return null;
  return () => {
    release(path, holder);
    removeIfPresent(marker);
  };
}
