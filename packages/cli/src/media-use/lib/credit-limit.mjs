import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A run's credit limit: the person's named total, in `.hyperframes/credit-limit.json` as {"credits": N}.
// What is spent is read back from the job log (`.hyperframes/heygen-jobs.jsonl`): the last credits a job key logged.

const read = (file) => (existsSync(file) ? readFileSync(file, "utf8") : "");

/** The limit set for this project, or undefined when the person named none. Unreadable is an error, never "none". */
export function creditLimit(projectDir) {
  const text = read(join(projectDir, ".hyperframes", "credit-limit.json"));
  if (!text) return undefined;
  const credits = Number(JSON.parse(text)?.credits);
  if (!Number.isFinite(credits) || credits < 0)
    throw new Error(`${projectDir}/.hyperframes/credit-limit.json needs {"credits": <number>}`);
  return credits;
}

/** Credits already committed by jobs in this project, and the job keys behind them. */
export function creditsSpent(projectDir) {
  const charged = new Map();
  for (const row of read(join(projectDir, ".hyperframes", "heygen-jobs.jsonl")).split("\n")) {
    if (!row) continue;
    const { key, credits } = JSON.parse(row);
    if (key && typeof credits === "number") charged.set(key, credits);
  }
  return {
    total: [...charged.values()].reduce((a, b) => a + b, 0),
    keys: new Set([...charged].filter(([, c]) => c > 0).map(([k]) => k)),
  };
}

/** The engine shells out to `heygen`, which prices nothing here: under a limit those calls are refused, and
 *  `media-use generate` (priced, counted against the limit) is the way to make the same piece. */
export function refuseUnderLimit(projectDir, what, generateType) {
  const limit = creditLimit(projectDir);
  if (limit === undefined) return;
  throw new Error(
    `media-use: ${what} cannot be priced here, so it cannot be kept under the run's credit limit of ${limit}; nothing was made. Make it with \`npx hyperframes media-use generate --type ${generateType}\`, which counts against the limit`,
  );
}
