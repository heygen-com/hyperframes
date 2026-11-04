import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { hyperframesCacheDir } from "@hyperframes/core/cache-dir";
import { alive, readHolder, release, tryAcquire, type Holder } from "./projectLock.js";

/** Who holds the machine-wide render slot. */
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
}

const POLL_MS = 1_000;

export const renderLockPath = () => hyperframesCacheDir("locks", "render.lock");

/** `HYPERFRAMES_RENDER_LOCK=off` lets renders on this machine run side by side. */
export function renderLockDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
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

/** A takeover of a dead holder whose own process died mid-takeover leaves `.break` behind for good. */
function clearAbandonedBreak(path: string, current: RenderLockHolder | null): boolean {
  if (current && alive(current.pid)) return false;
  const breakPath = `${path}.break`;
  const breaker = readHolder(breakPath);
  if (!breaker || alive(breaker.pid)) return false;
  try {
    unlinkSync(breakPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return true;
}

const sameWaitTarget = (a: RenderLockHolder | null, b: RenderLockHolder | null) =>
  a?.pid === b?.pid && a?.startedAt === b?.startedAt;

/**
 * Takes the one render slot on this machine, waiting while a live process holds it; a holder whose
 * process is gone is taken over. Returns the release.
 */
export async function acquireRenderLock(options: RenderLockOptions): Promise<() => void> {
  if (renderLockDisabled(options.env)) return () => {};
  const path = options.path ?? renderLockPath();
  mkdirSync(dirname(path), { recursive: true });
  const holder: RenderLockHolder = {
    pid: process.pid,
    command: "render",
    startedAt: Date.now(),
    project: options.project,
  };
  let waitingBehind: RenderLockHolder | null | undefined;
  while (!tryAcquire(path, holder)) {
    const current = readHolder<RenderLockHolder>(path);
    if (!current && !existsSync(path)) continue;
    if (clearAbandonedBreak(path, current)) continue;
    if (!options.wait) throw new RenderLockBusy(current, path);
    if (waitingBehind === undefined || !sameWaitTarget(waitingBehind, current)) {
      waitingBehind = current;
      options.onWait?.(current, path);
    }
    await pause(options.pollMs ?? POLL_MS, options.signal);
  }
  return () => release(path, holder);
}
