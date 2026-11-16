import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { configDir } from "../auth/paths.js";
import { Fix } from "../measure/media.js";
import { creditsSpent } from "../media-use/lib/credit-limit.mjs";

// Each account's own record of what its jobs in a project folder hold, kept in its config folder and never in the
// project, so a job log row a sync or a pull brings in can neither lower it nor let a call skip the limit.
const ledgerFile = () => join(configDir(), "heygen-job-ledger");
const LINES_KEPT = 10_000;

type Kind = "own" | "seen";
type Ledger = Record<Kind, Map<string, number>>;

const toCredits = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/** Where ledger lines belong: this account and this project folder; null when either cannot be told. A moved or
 *  renamed folder starts a new ledger. */
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

function parse(line: string): Record<string, unknown> | null {
  try {
    return Object(JSON.parse(line));
  } catch {
    return null;
  }
}

function readLedger(at: string): Ledger {
  const ledger: Ledger = { own: new Map(), seen: new Map() };
  const file = ledgerFile();
  if (!existsSync(file)) return ledger;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const row = parse(line);
    if (!row) continue;
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
  if (kept.length <= LINES_KEPT) return;
  const temp = `${ledgerFile()}.${process.pid}.tmp`;
  writeFileSync(temp, `${trimmed(kept, at).join("\n")}\n`, { mode: 0o600 });
  renameSync(temp, ledgerFile());
}

/** The newest lines up to LINES_KEPT, always with the last line `at` holds for each key. */
function trimmed(lines: string[], at: string): string[] {
  const last = new Map<string, number>();
  const live = lines.map((line, n) => {
    const row = parse(line);
    if (row?.at === at) last.set(`${String(row.kind)} ${String(row.key)}`, n);
    return row?.at === at;
  });
  const keep = new Set(last.values());
  let room = LINES_KEPT - keep.size;
  for (let n = lines.length - 1; n >= 0 && room > 0; n--)
    if (!live[n]) {
      keep.add(n);
      room--;
    }
  return lines.filter((_, n) => keep.has(n));
}

export function noteOwn(at: string | null, key: string, credits: number): void {
  if (at) note(at, "own", [[key, toCredits(credits)]]);
}

export interface Spent {
  total: number;
  own: Map<string, number>;
  others: Map<string, number>;
  /** Credits counted from other keys' highest seen values above what the job log holds now. */
  gone: number;
}

/** What a project's jobs hold: this account's keys at what it noted, any other key in the job log at the most it was
 *  seen to hold. A new highest for another key is noted. With no account to read it for, nothing is trusted. */
export function spentIn(projectDir: string, at: string | null): Spent {
  if (!at)
    throw new Fix(
      "can't tell which account is signed in, so the limit can't be checked; nothing was made",
      "run the same command again; if this comes back, npx hyperframes auth login",
    );
  const ledger = readLedger(at);
  const logged = creditsSpent(projectDir).keys;
  const others = new Map(ledger.seen);
  for (const [key, credits] of logged) others.set(key, Math.max(credits, others.get(key) ?? 0));
  for (const key of ledger.own.keys()) others.delete(key);
  note(
    at,
    "seen",
    [...others].filter(([key, credits]) => credits > (ledger.seen.get(key) ?? 0)),
  );
  const total = [...ledger.own.values(), ...others.values()].reduce((a, b) => a + b, 0);
  let gone = 0;
  for (const [key, credits] of others) gone += credits - (logged.get(key) ?? 0);
  return { total, own: ledger.own, others, gone };
}

export const goneNote = (spent: Spent): string =>
  spent.gone > 0
    ? `. ${spent.gone} of the credits counted are from job log rows no longer in the project, noted in ${ledgerFile()}`
    : "";
