import { hostname } from "node:os";
import { join } from "node:path";
import { mkdirInside, readJsonRecord, writeJsonAtomic, rm } from "@hyperframes/share/storage.mjs";
import { withProjectShareLock } from "@hyperframes/share/projectLock.mjs";

export type SharePhase =
  | "preparing"
  | "rendering"
  | "uploading_source"
  | "uploading_video"
  | "checking";
export interface ShareActivity {
  step: SharePhase;
  startedAt: string;
}
const phases = [
  "preparing",
  "rendering",
  "uploading_source",
  "uploading_video",
  "checking",
] as const;
const fileFor = (dir: string) => join(dir, ".hyperframes", "share-activity.json");

export async function readShareActivity(dir: string): Promise<ShareActivity | null> {
  const value = await readJsonRecord(fileFor(dir));
  if (
    !value ||
    value.hostname !== hostname() ||
    typeof value.pid !== "number" ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0
  )
    return null;
  const step = phases.find((step) => step === value.step);
  if (
    !step ||
    typeof value.startedAt !== "string" ||
    typeof value.updatedAt !== "number" ||
    Date.now() - value.updatedAt > 60000
  )
    return null;
  try {
    process.kill(value.pid, 0);
  } catch {
    return null;
  }
  return { step, startedAt: value.startedAt };
}

export async function withShareActivity<T>(
  dir: string,
  run: (phase: (step: SharePhase) => Promise<void>) => Promise<T>,
): Promise<T> {
  return withProjectShareLock(
    dir,
    "operation",
    async () => {
      await mkdirInside(dir, ".hyperframes");
      const startedAt = new Date().toISOString();
      let step: SharePhase = "preparing";
      let pending = Promise.resolve();
      const phase = (next: SharePhase) => {
        step = next;
        pending = writeJsonAtomic(fileFor(dir), {
          step,
          startedAt,
          updatedAt: Date.now(),
          pid: process.pid,
          hostname: hostname(),
        });
        void pending.catch(() => {});
        return pending;
      };
      const heartbeat = setInterval(() => {
        void phase(step);
      }, 10000);
      heartbeat.unref();
      try {
        await phase("preparing");
        return await run(phase);
      } finally {
        clearInterval(heartbeat);
        await pending.catch(() => {});
        await rm(fileFor(dir), { force: true });
      }
    },
    { timeoutMs: 0 },
  );
}
