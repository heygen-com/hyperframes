import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { configDir } from "../auth/paths.js";
import { creditsSpent } from "../media-use/lib/credit-limit.mjs";

// Each account's own record of what its jobs in a project folder hold, kept in its config folder and never in the
// project, so a job log row a sync or a pull brings in can neither lower it nor let a call skip the limit.
const ledgerFile = () => join(configDir(), "heygen-job-ledger");
const LINES_KEPT = 10_000;

type Kind = "own" | "seen";
type Ledger = Record<Kind, Map<string, number>>;

const toCredits = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/** Where ledger lines belong: this account and this project folder; null when either cannot be told. */
export function ledgerScope(scope: string | null, projectDir: string | undefined): string | null {
  if (!scope || !projectDir) return null;
  let real: string;
  try {
    real = realpathSync(projectDir);
  } catch {
    real = resolve(projectDir);
  }
  return `${scope}:${createHash("sha256").update(real).digest("hex").slice(0, 16)}`;
}

function readLedger(at: string | null): Ledger {
  const ledger: Ledger = { own: new Map(), seen: new Map() };
  const file = ledgerFile();
  if (!at || !existsSync(file)) return ledger;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    let row: Record<string, unknown>;
    try {
      row = Object(JSON.parse(line));
    } catch {
      continue;
    }
    const { kind, key } = row;
    if (row.at === at && typeof key === "string" && (kind === "own" || kind === "seen"))
      ledger[kind].set(key, toCredits(row.credits));
  }
  return ledger;
}

function note(at: string, kind: Kind, entries: [string, number][]): void {
  if (entries.length === 0) return;
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const lines = entries.map(([key, credits]) => `${JSON.stringify({ at, kind, key, credits })}\n`);
  appendFileSync(ledgerFile(), lines.join(""), { mode: 0o600 });
  const kept = readFileSync(ledgerFile(), "utf8").split("\n").filter(Boolean);
  if (kept.length > LINES_KEPT)
    writeFileSync(ledgerFile(), `${kept.slice(-LINES_KEPT).join("\n")}\n`);
}

export function noteOwn(at: string | null, key: string, credits: number): void {
  if (at) note(at, "own", [[key, toCredits(credits)]]);
}

export interface Spent {
  total: number;
  own: Map<string, number>;
  others: Map<string, number>;
}

/** What a project's jobs hold: this account's keys at what it noted, any other key in the job log at the most it was
 *  seen to hold. A new highest for another key is noted. */
export function spentIn(projectDir: string, at: string | null): Spent {
  const ledger = readLedger(at);
  const others = new Map(ledger.seen);
  for (const [key, credits] of creditsSpent(projectDir).keys)
    others.set(key, Math.max(credits, others.get(key) ?? 0));
  for (const key of ledger.own.keys()) others.delete(key);
  if (at)
    note(
      at,
      "seen",
      [...others].filter(([key, credits]) => credits > (ledger.seen.get(key) ?? 0)),
    );
  const total = [...ledger.own.values(), ...others.values()].reduce((a, b) => a + b, 0);
  return { total, own: ledger.own, others };
}
