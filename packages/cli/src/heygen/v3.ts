// HeyGen's v3 job routes through the hyperframes credential chain (API key, host token or OAuth, refreshed). A paid
// call carries an Idempotency-Key derived from what it asks for, so the same command again picks up the same job
// rather than paying twice; a failed job is asked again. Every job is logged to .hyperframes/heygen-jobs.jsonl.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "../auth/paths.js";
import { AuthClient, buildAuthHeaders } from "../auth/client.js";
import { resolveCredential } from "../auth/resolver.js";
import { refreshIfNeeded, resolveCloudAuthHeaders, resolveCloudBaseUrl } from "../cloud/auth.js";
import { Fix } from "../measure/media.js";
import { pageUrl } from "./plan.js";

export interface Job {
  id: string;
  status: string;
  failure_code?: string;
  failure_message?: string;
  [field: string]: unknown;
}

const RUNNING = new Set(["pending", "processing", "queued", "running", "waiting", "in_progress"]);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The same request always gets the same key: a re-run is a resume, never a second charge. */
export function idempotencyKey(route: string, parts: readonly (string | Buffer)[]): string {
  const h = createHash("sha256").update(route);
  for (const p of parts) h.update(p).update("\0");
  return `hf-${h.digest("hex").slice(0, 40)}`;
}

class Refused extends Fix {
  status = 0;
}

/** Refusals that say nothing about the job: a lost answer may have started it, so a retry keeps its key. */
const KEEPS_KEY = new Set([401, 403, 408, 409, 425, 429]);

const failedKeysFile = () => join(configDir(), "heygen-failed-keys");

const noSignIn = (): never => {
  throw new Fix("no HeyGen sign-in on this machine", "npx hyperframes auth login");
};

interface Sender {
  auth: Record<string, string>;
  /** Who failures belong to: this API and this account; null when the account cannot be told. */
  scope: string | null;
}

/** Fixed when a job starts: a sign-in during it must not send the job or own its failure. */
async function jobSender(): Promise<Sender> {
  const credential = await resolveCredential().then(refreshIfNeeded).catch(noSignIn);
  const who =
    credential.type === "api_key"
      ? credential.key
      : await new AuthClient().getCurrentUser(credential).then(
          (user) => user.username ?? user.email,
          () => undefined,
        );
  const scope = who
    ? createHash("sha256").update(`${resolveCloudBaseUrl()}\0${who}`).digest("hex").slice(0, 16)
    : null;
  return { auth: buildAuthHeaders(credential), scope };
}

function failedKeys(scope: string): Set<string> {
  const file = failedKeysFile();
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  return new Set(
    lines.filter((l) => l.startsWith(`${scope} `)).map((l) => l.slice(scope.length + 1)),
  );
}

function markFailed(key: string, scope: string | null): void {
  if (!scope) return;
  mkdirSync(configDir(), { recursive: true });
  appendFileSync(failedKeysFile(), `${scope} ${key}\n`);
}

/** The key to send: `key` itself, or past every key whose job failed or was refused, so a retry is a new job. */
function liveKey(key: string, scope: string | null): string {
  const failed = scope ? failedKeys(scope) : new Set<string>();
  let sent = key;
  for (let n = 1; failed.has(sent); n++) sent = `${key}-${n}`;
  return sent;
}

/** A refused call says what to do: sign in, subscribe, add credits, or change the request. `estimate` is the
 *  caller's own price for the call (what `--plan` prints), named when HeyGen does not say what the step needs. */
// fallow-ignore-next-line complexity
function refusal(status: number, body: unknown, estimate?: number): Refused {
  const err = isRecord(body) && isRecord(body.error) ? body.error : isRecord(body) ? body : {};
  const code = String(err.code ?? err.failure_code ?? "");
  const message = String(err.message ?? err.failure_message ?? "").slice(0, 300);
  const url = typeof err.url === "string" ? err.url : undefined;
  const given = Number(err.needed_credits) || undefined;
  const needed = given ?? (estimate || undefined);
  const needs = given ? String(given) : needed ? `about ${needed}` : "more";
  const balance = err.balance === undefined ? "" : `, balance ${String(err.balance)}`;
  // The fix is the one line the agent relays as printed; the problem says how to wait for the person.
  if (/hf_subscription_required/i.test(code))
    return new Refused(
      `this is a HyperFrames Pro feature; nothing was charged. Run \`npx hyperframes billing subscribe\`: it opens the page and waits`,
      `Subscribe: ${url ?? pageUrl("plans", { needed })}`,
    );
  if (/hf_usage_exhausted/i.test(code))
    return new Refused(
      `out of HyperFrames credits (this step needs ${needs}${balance}); nothing was charged. Run \`npx hyperframes billing top-up${needed ? ` --needed ${needed}` : ""}\`: it opens the page and waits`,
      `Add credits: ${url ?? pageUrl("credits", { needed })}`,
    );
  if (/api_key_required/i.test(code))
    return new Refused(
      "this HeyGen feature is not available with this sign-in yet; nothing was charged",
      "continue without this step",
    );
  if (status === 401 || status === 403)
    return new Refused(
      `HeyGen refused the credential (${status}${message ? `: ${message}` : ""})`,
      "npx hyperframes auth login",
    );
  if (status === 402 || /insufficient|credit|usage_exhausted|quota/i.test(code))
    return new Refused(
      `HeyGen says there is not enough credit (${code || status})`,
      "top up at https://app.heygen.com, or sign in with npx hyperframes auth login to use the plan's allowance",
    );
  if (/content_policy/i.test(code))
    return new Refused(
      `HeyGen declined the content: ${message || code}`,
      "reword the prompt once without the flagged part",
    );
  return new Refused(
    `HeyGen ${status}${code ? ` ${code}` : ""}: ${message || "request refused"}`,
    "fix the request it names, then run again",
  );
}

// fallow-ignore-next-line complexity
async function call(
  method: "GET" | "POST",
  route: string,
  body?: unknown,
  key?: string,
  estimate?: number,
  auth?: Record<string, string>,
): Promise<Job> {
  const headers: Record<string, string> = {
    ...(auth ?? (await resolveCloudAuthHeaders().catch(noSignIn))),
    accept: "application/json",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (key) headers["Idempotency-Key"] = key;
  let res: Response;
  try {
    res = await fetch(`${resolveCloudBaseUrl()}${route}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(method === "POST" ? 180_000 : 30_000),
    });
  } catch (err) {
    throw new Fix(
      `no answer from HeyGen for ${route} (${err instanceof Error ? err.message : String(err)})`,
      "run the same command again: it resumes the same job",
    );
  }
  const value: unknown = await res.json().catch(() => null);
  if (res.status >= 500 || value === null)
    throw new Fix(
      `HeyGen ${res.status} for ${route} with no readable answer`,
      "run the same command again: it resumes the same job",
    );
  if (!res.ok) {
    const refused = refusal(res.status, value, estimate);
    refused.status = res.status;
    throw refused;
  }
  const data = isRecord(value) && isRecord(value.data) ? value.data : value;
  if (!isRecord(data))
    throw new Fix(`HeyGen answered ${route} with no job`, "run the same command again");
  const id = data.id ?? data.job_id ?? data.video_id ?? data.generation_id;
  return {
    ...data,
    id: typeof id === "string" ? id : "",
    status: String(data.status ?? (id ? "pending" : "completed")),
  };
}

export interface JobLog {
  /** The project whose .hyperframes/heygen-jobs.jsonl records the job; omitted, nothing is logged. */
  projectDir?: string;
  /** What the job is for, in a few words. */
  what: string;
}

function log(entry: JobLog, record: Record<string, unknown>) {
  if (!entry.projectDir) return;
  const dir = join(entry.projectDir, ".hyperframes");
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    join(dir, "heygen-jobs.jsonl"),
    `${JSON.stringify({ at: new Date().toISOString(), what: entry.what, ...record })}\n`,
  );
}

export interface RunOptions {
  /** How long to wait for the job to finish before handing back its id. */
  timeoutMs?: number;
  intervalMs?: number;
  onWait?: (job: Job) => void;
  log?: JobLog;
  /** What the call is priced at in credits, named in an out-of-credits refusal that does not say. */
  credits?: number;
}

/** Starts a job (or picks up the one this key already started) and polls `pollRoute(id)` until it ends. */
export async function runJob(
  route: string,
  body: unknown,
  key: string,
  pollRoute: (id: string) => string,
  opts: RunOptions = {},
): Promise<Job> {
  const started = Date.now();
  const { auth, scope } = await jobSender();
  const sent = liveKey(key, scope);
  let job: Job;
  try {
    job = await call("POST", route, body, sent, opts.credits, auth);
  } catch (err) {
    if (err instanceof Refused && !KEEPS_KEY.has(err.status)) markFailed(sent, scope);
    throw err;
  }
  if (opts.log) log(opts.log, { route, id: job.id, key: sent, status: job.status });
  while (RUNNING.has(job.status.toLowerCase())) {
    if (Date.now() - started > (opts.timeoutMs ?? 15 * 60_000))
      throw new Fix(
        `HeyGen job ${job.id} is still ${job.status}`,
        "run the same command again later: it picks up this job",
      );
    opts.onWait?.(job);
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 5000));
    job = await call("GET", pollRoute(job.id));
  }
  if (opts.log) log(opts.log, { route, id: job.id, key: sent, status: job.status });
  if (!/^(completed|succeeded|success|done)$/i.test(job.status)) {
    markFailed(sent, scope);
    throw refusal(422, {
      error: { code: job.failure_code ?? job.status, message: job.failure_message ?? "" },
    });
  }
  return job;
}
