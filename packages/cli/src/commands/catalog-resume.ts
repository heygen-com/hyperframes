import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type PrimitiveInstallStatus =
  | "pending"
  | "awaiting-auth"
  | "installing"
  | "completed"
  | "cancelled"
  | "failed";

export interface PendingPrimitiveInstall {
  schemaVersion: 1;
  itemName: string;
  artifactId: string;
  versionId: string;
  funnelId: string;
  installId: string;
  queryFingerprint: string;
  status: PrimitiveInstallStatus;
}

export interface PrimitiveInstallStateStore {
  load(): Promise<PendingPrimitiveInstall | null>;
  save(state: PendingPrimitiveInstall): Promise<void>;
  acquireClaim?(): Promise<PrimitiveInstallClaim>;
}

export interface PrimitiveInstallClaim {
  release(): Promise<void>;
}

export interface CreatePrimitiveInstallIntentArgs {
  itemName: string;
  query: string;
  artifactId: string;
  versionId: string;
  funnelId?: string;
  installId?: string;
}

export function filterPrimitiveCatalogItems<
  T extends { name: string; title: string; description: string },
>(items: T[], query: string): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return items;
  return items.filter((item) =>
    [item.name, item.title, item.description].some((value) =>
      value.toLowerCase().includes(normalized),
    ),
  );
}

export function createPrimitiveInstallIntent(
  args: CreatePrimitiveInstallIntentArgs,
): PendingPrimitiveInstall {
  return {
    schemaVersion: 1,
    itemName: args.itemName,
    artifactId: args.artifactId,
    versionId: args.versionId,
    funnelId: args.funnelId ?? randomUUID(),
    installId: args.installId ?? randomUUID(),
    queryFingerprint: createHash("sha256").update(args.query).digest("hex"),
    status: "pending",
  };
}

export type PrimitiveAuthenticationOutcome = boolean | "cancelled" | "failed";

export interface PrimitiveInstallResumeDeps {
  store: PrimitiveInstallStateStore;
  isAuthenticated(): Promise<boolean>;
  authenticate(): Promise<PrimitiveAuthenticationOutcome>;
  install(intent: PendingPrimitiveInstall): Promise<void>;
}

export type PrimitiveInstallResumeResult =
  | "installed"
  | "already-installed"
  | "cancelled"
  | "failed";

/**
 * Persist the source-owned selection before OAuth and consume that same install
 * id exactly once after authentication. No authored query or message content is
 * stored in the resume state.
 */
export async function resumePrimitiveInstallExactlyOnce(
  intent: PendingPrimitiveInstall,
  deps: PrimitiveInstallResumeDeps,
): Promise<PrimitiveInstallResumeResult> {
  const claim = deps.store.acquireClaim ? await deps.store.acquireClaim() : null;
  try {
    const persisted = await deps.store.load();
    const terminal = terminalResumeResult(persisted, intent.installId);
    if (terminal) return terminal;

    let state: PendingPrimitiveInstall = {
      ...(persisted?.installId === intent.installId ? persisted : intent),
    };
    await deps.store.save(state);

    const authentication = await authenticateClaimedInstall(state, deps);
    if (authentication.result) return authentication.result;
    state = authentication.state;

    return await installClaimedPrimitive(state, deps);
  } finally {
    await claim?.release();
  }
}

function terminalResumeResult(
  persisted: PendingPrimitiveInstall | null,
  installId: string,
): PrimitiveInstallResumeResult | null {
  if (persisted?.installId !== installId) return null;
  if (persisted.status === "completed") return "already-installed";
  if (persisted.status === "cancelled") return "cancelled";
  if (persisted.status === "failed") return "failed";
  return null;
}

async function authenticateClaimedInstall(
  state: PendingPrimitiveInstall,
  deps: PrimitiveInstallResumeDeps,
): Promise<{ state: PendingPrimitiveInstall; result?: "cancelled" | "failed" }> {
  if (await deps.isAuthenticated()) return { state };
  const awaiting = { ...state, status: "awaiting-auth" as const };
  await deps.store.save(awaiting);
  const auth = await deps.authenticate();
  if (auth === true) return { state: awaiting };
  const result = auth === "cancelled" ? "cancelled" : "failed";
  await deps.store.save({ ...awaiting, status: result });
  return { state: awaiting, result };
}

async function installClaimedPrimitive(
  state: PendingPrimitiveInstall,
  deps: PrimitiveInstallResumeDeps,
): Promise<"installed"> {
  const installing = { ...state, status: "installing" as const };
  await deps.store.save(installing);
  try {
    await deps.install(installing);
  } catch (error) {
    await deps.store.save({ ...installing, status: "failed" });
    throw error;
  }
  await deps.store.save({ ...installing, status: "completed" });
  return "installed";
}

export interface FilePrimitiveInstallStateStoreOptions {
  staleClaimMs?: number;
  claimWaitMs?: number;
  pollMs?: number;
  heartbeatMs?: number;
}

export function createFilePrimitiveInstallStateStore(
  path = join(homedir(), ".hyperframes", "pending-primitive-install.json"),
  options: FilePrimitiveInstallStateStoreOptions = {},
): PrimitiveInstallStateStore {
  const claimDir = `${path}.claim`;
  const staleClaimMs = options.staleClaimMs ?? 30_000;
  const claimWaitMs = options.claimWaitMs ?? 60_000;
  const pollMs = options.pollMs ?? 25;
  const heartbeatMs = options.heartbeatMs ?? Math.max(250, Math.floor(staleClaimMs / 3));
  return {
    async load() {
      try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as PendingPrimitiveInstall;
        return parsed.schemaVersion === 1 ? parsed : null;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || error instanceof SyntaxError) return null;
        throw error;
      }
    },
    async save(state) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporaryPath, path);
    },
    async acquireClaim() {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const token = randomUUID();
      const deadline = Date.now() + claimWaitMs;
      while (true) {
        try {
          await mkdir(claimDir, { mode: 0o700 });
          await writeFile(
            join(claimDir, "owner.json"),
            `${JSON.stringify({ pid: process.pid, token })}\n`,
            { encoding: "utf8", mode: 0o600 },
          );
          const heartbeat = setInterval(() => {
            const now = new Date();
            void utimes(claimDir, now, now).catch(() => undefined);
          }, heartbeatMs);
          heartbeat.unref();
          return {
            async release() {
              clearInterval(heartbeat);
              try {
                const owner = JSON.parse(await readFile(join(claimDir, "owner.json"), "utf8")) as {
                  token?: string;
                };
                if (owner.token === token) await rm(claimDir, { recursive: true, force: true });
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
              }
            },
          };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          if (await reclaimDeadClaim(claimDir, staleClaimMs)) continue;
          if (Date.now() >= deadline) {
            throw new Error("thread-message-stack install is already claimed by another process");
          }
          await new Promise((resolveDelay) => setTimeout(resolveDelay, pollMs));
        }
      }
    },
  };
}

async function reclaimDeadClaim(claimDir: string, staleClaimMs: number): Promise<boolean> {
  let ageMs: number;
  try {
    ageMs = Date.now() - (await stat(claimDir)).mtimeMs;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
  if (ageMs < staleClaimMs) return false;

  let ownerPid: number | undefined;
  try {
    const owner = JSON.parse(await readFile(join(claimDir, "owner.json"), "utf8")) as {
      pid?: unknown;
    };
    if (typeof owner.pid === "number") ownerPid = owner.pid;
  } catch {
    ownerPid = undefined;
  }
  if (ownerPid !== undefined && isProcessAlive(ownerPid)) return false;

  const abandoned = `${claimDir}.abandoned.${process.pid}.${randomUUID()}`;
  try {
    await rename(claimDir, abandoned);
    await rm(abandoned, { recursive: true, force: true });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
