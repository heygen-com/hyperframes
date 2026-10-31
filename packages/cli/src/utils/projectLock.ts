import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { createFileAtomically } from "@hyperframes/core/atomic-file";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { readToolContext, type ToolContext } from "./toolContext.js";

export class ProjectLockTimeout extends Error {}

interface Holder {
  pid: number;
  command: string;
  startedAt: number;
}

const POLL_MS = 250;

export const projectLockPath = (projectDir: string) =>
  join(projectDir, ".hyperframes", "project.lock");

function readHolder(path: string): Holder | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Holder;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const sameHolder = (a: Holder | null, b: Holder) =>
  a?.pid === b.pid && a.startedAt === b.startedAt && a.command === b.command;

function breakStaleHolder(path: string, current: Holder, holder: Holder): boolean {
  const breakPath = `${path}.break`;
  if (!createNew(breakPath, holder)) return false;
  try {
    if (sameHolder(readHolder(path), current)) {
      try {
        unlinkSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return tryAcquire(path, holder);
  } finally {
    if (sameHolder(readHolder(breakPath), holder)) unlinkSync(breakPath);
  }
}

function createNew(path: string, holder: Holder): boolean {
  try {
    createFileAtomically(path, JSON.stringify(holder));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

function tryAcquire(path: string, holder: Holder): boolean {
  if (createNew(path, holder)) return true;
  const current = readHolder(path);
  if (current && !alive(current.pid)) return breakStaleHolder(path, current, holder);
  return false;
}

export async function withProjectLock<T>(
  projectDir: string,
  command: string,
  run: () => Promise<T>,
  context: ToolContext = readToolContext(),
): Promise<T> {
  if (!context.projectLock) return run();
  const path = projectLockPath(projectDir);
  mkdirSync(dirname(path), { recursive: true });
  const holder: Holder = { pid: process.pid, command, startedAt: Date.now() };
  const deadline = holder.startedAt + context.projectLock.waitMs;
  while (!tryAcquire(path, holder)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      const current = readHolder(path);
      const breakPath = `${path}.break`;
      const breaker = readHolder(breakPath);
      if ((!current || !alive(current.pid)) && breaker && !alive(breaker.pid)) {
        throw new ProjectLockTimeout(
          `hyperframes left ${breakPath} (pid ${breaker.pid}); delete it to continue`,
        );
      }
      throw new ProjectLockTimeout(
        `hyperframes ${current?.command ?? "another command"} (pid ${current?.pid ?? "unknown"}) ` +
          `is still using this project after ${Math.round(context.projectLock.waitMs / 1000)}s`,
      );
    }
    await sleep(Math.min(POLL_MS, remaining));
  }
  try {
    return await run();
  } finally {
    if (sameHolder(readHolder(path), holder)) unlinkSync(path);
  }
}
