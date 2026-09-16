import {
  processAncestorSnapshot,
  processIdentity,
  processParentPid,
  type ProcessAncestor,
} from "./orphanCleanup.js";
import { processIsAlive } from "./processTree.js";

type RenderCancellationSignal = "SIGINT" | "SIGTERM" | "SIGHUP";

interface RenderSignalTarget {
  on(event: RenderCancellationSignal, listener: () => void): unknown;
  off(event: RenderCancellationSignal, listener: () => void): unknown;
}

type RenderAncestor = ProcessAncestor;

export interface RenderCancellationScopeOptions {
  signalTarget?: RenderSignalTarget;
  parentPid?: (pid: number) => number | null;
  identity?: (pid: number) => string | null;
  ancestorSnapshot?: (pid: number) => ProcessAncestor[];
  isAlive?: (pid: number) => boolean;
  pid?: number;
  parentPollIntervalMs?: number;
  platform?: NodeJS.Platform;
  detached?: boolean;
}

export interface RenderCancellationScope {
  signal: AbortSignal;
  checkAncestors: () => void;
  dispose: () => void;
}

const RENDER_CANCELLATION_SIGNALS: readonly RenderCancellationSignal[] = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
];

function captureAncestors(
  pid: number,
  lookupParentPid: (pid: number) => number | null,
  lookupIdentity: (pid: number) => string | null,
  isAlive: (pid: number) => boolean,
): RenderAncestor[] {
  const ancestors: RenderAncestor[] = [];
  const visited = new Set<number>([pid]);
  let current = pid;

  for (let depth = 0; depth < 64; depth++) {
    const parent = lookupParentPid(current);
    if (parent === null || parent <= 1 || visited.has(parent)) break;
    visited.add(parent);
    if (!isAlive(parent)) break;
    const identity = lookupIdentity(parent);
    if (identity === null) break;
    ancestors.push({ pid: parent, identity });
    current = parent;
  }

  return ancestors;
}

function captureRenderAncestors(
  options: RenderCancellationScopeOptions,
  platform: NodeJS.Platform,
  pid: number,
  lookupIdentity: (pid: number) => string | null,
  isAlive: (pid: number) => boolean,
): RenderAncestor[] {
  if (options.detached ?? process.env.HYPERFRAMES_RENDER_DETACHED === "1") return [];
  if (platform !== "linux" && options.parentPid === undefined && options.identity === undefined) {
    return (options.ancestorSnapshot ?? processAncestorSnapshot)(pid);
  }
  return captureAncestors(pid, options.parentPid ?? processParentPid, lookupIdentity, isAlive);
}

function installSignalHandlers(
  detached: boolean,
  signalTarget: RenderSignalTarget,
  abort: (reason: string) => void,
): Map<RenderCancellationSignal, () => void> {
  const signalHandlers = new Map<RenderCancellationSignal, () => void>();
  const handledSignals = detached
    ? RENDER_CANCELLATION_SIGNALS.filter((signal) => signal !== "SIGHUP")
    : RENDER_CANCELLATION_SIGNALS;
  for (const signal of handledSignals) {
    const handler = () => abort(`render_cancelled_by_${signal.toLowerCase()}`);
    signalHandlers.set(signal, handler);
    signalTarget.on(signal, handler);
  }
  return signalHandlers;
}

export function createRenderCancellationScope(
  options: RenderCancellationScopeOptions = {},
): RenderCancellationScope {
  const controller = new AbortController();
  const signalTarget = options.signalTarget ?? process;
  const abort = (reason: string): void => {
    if (!controller.signal.aborted) controller.abort(new Error(reason));
  };

  const detached = options.detached ?? process.env.HYPERFRAMES_RENDER_DETACHED === "1";
  const signalHandlers = installSignalHandlers(detached, signalTarget, abort);
  const lookupIdentity = options.identity ?? processIdentity;
  const isAlive = options.isAlive ?? processIsAlive;
  const platform = options.platform ?? process.platform;
  const pid = options.pid ?? process.pid;
  const ancestors = captureRenderAncestors(options, platform, pid, lookupIdentity, isAlive);
  const checkAncestorLiveness = (): boolean => {
    for (const ancestor of ancestors) {
      if (!isAlive(ancestor.pid)) {
        abort("render_cancelled_parent_exited");
        return false;
      }
    }
    return true;
  };
  const checkAncestors = (): void => {
    if (!checkAncestorLiveness()) return;
    if (platform !== "linux") return;
    for (const ancestor of ancestors) {
      const currentIdentity = lookupIdentity(ancestor.pid);
      if (currentIdentity !== null && currentIdentity !== ancestor.identity) {
        abort("render_cancelled_parent_exited");
        return;
      }
    }
  };
  const defaultPollIntervalMs = ancestors.length > 0 && platform === "linux" ? 250 : 2_000;
  const watchdogTimer = setInterval(
    platform === "linux" ? checkAncestors : () => void checkAncestorLiveness(),
    options.parentPollIntervalMs ?? defaultPollIntervalMs,
  );

  let disposed = false;
  return {
    signal: controller.signal,
    checkAncestors,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (watchdogTimer !== undefined) clearInterval(watchdogTimer);
      for (const [signal, handler] of signalHandlers) signalTarget.off(signal, handler);
    },
  };
}
