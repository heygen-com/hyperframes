import type {
  LocalShareAction,
  LocalShareAudience,
  LocalShareJob,
  LocalShareSnapshot,
  LocalShareState,
  LocalShareSpace,
} from "@hyperframes/studio-server";
import { studioApiFetch } from "../../utils/studioApiFetch";

const audiences: readonly LocalShareAudience[] = ["public", "team", "invite", "private"];
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const nullableText = (value: unknown): value is string | null => value === null || text(value);
const nullableBoolean = (value: unknown): value is boolean | null =>
  value === null || typeof value === "boolean";
const nullableNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value));
export const isAudience = (value: unknown): value is LocalShareAudience =>
  audiences.some((mode) => mode === value);
function isState(value: unknown): value is LocalShareState {
  return (
    record(value) &&
    ["not_shared", "link_off", "ready", "processing", "failed", "unavailable"].includes(
      String(value.state),
    ) &&
    optionalFailure(value.failure) &&
    nullableText(value.url) &&
    text(value.manageUrl) &&
    nullableBoolean(value.changed) &&
    nullableAudience(value.audience) &&
    nullableText(value.spaceId) &&
    ["not_checked", "ready", "video_only"].includes(String(value.source))
  );
}
function isSpace(value: unknown): value is LocalShareSpace {
  return (
    record(value) &&
    text(value.id) &&
    text(value.name) &&
    typeof value.bound === "boolean" &&
    typeof value.canCreate === "boolean" &&
    Array.isArray(value.audiences) &&
    value.audiences.every(isAudience) &&
    nullableNumber(value.used) &&
    nullableNumber(value.limit)
  );
}
function isError(value: unknown): boolean {
  return value === null || (record(value) && text(value.code) && text(value.message));
}

function isJob(value: unknown): value is LocalShareJob {
  return (
    record(value) &&
    text(value.id) &&
    ["running", "done", "failed"].includes(String(value.state)) &&
    text(value.step) &&
    (value.result === null || isState(value.result)) &&
    isError(value.error)
  );
}
function isSnapshot(value: unknown): value is LocalShareSnapshot {
  return (
    record(value) &&
    typeof value.versionSharing === "boolean" &&
    isState(value.share) &&
    Array.isArray(value.spaces) &&
    value.spaces.every(isSpace) &&
    (value.job === null || isJob(value.job))
  );
}
export class LocalShareError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly job: LocalShareJob | null = null,
  ) {
    super(message);
  }
}
async function json(
  path: string,
  token: string | null,
  signal: AbortSignal,
  action?: LocalShareAction,
): Promise<unknown> {
  const response = await studioApiFetch(`/api/share/${path}`, {
    method: action ? "POST" : "GET",
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    headers: {
      ...(token ? { "X-Hyperframes-Share-CSRF": token } : {}),
      ...(action ? { "Content-Type": "application/json" } : {}),
    },
    ...(action ? { body: JSON.stringify(action) } : {}),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw responseError(body);
  return body;
}
function responseError(body: unknown): LocalShareError {
  const code = record(body) && text(body.code) ? body.code : "unavailable";
  const message =
    record(body) && text(body.message)
      ? body.message
      : "Sharing is unavailable. Try again from a local Studio preview.";
  const job = record(body) && isJob(body.job) ? body.job : null;
  return new LocalShareError(code, message, job);
}

export async function shareBootstrap(signal: AbortSignal): Promise<string> {
  const value = await json("bootstrap", null, signal);
  if (!record(value) || !text(value.csrf) || !/^[A-Za-z0-9_-]{43}$/.test(value.csrf))
    throw new LocalShareError("unavailable", "Sharing is not available in this Studio host.");
  return value.csrf;
}
export async function shareSnapshot(
  token: string,
  signal: AbortSignal,
): Promise<LocalShareSnapshot> {
  const value = await json("snapshot", token, signal);
  if (!isSnapshot(value))
    throw new LocalShareError(
      "unavailable",
      "Sharing returned an unreadable response. Refresh Studio.",
    );
  return value;
}
export async function shareAction(
  token: string,
  action: LocalShareAction,
  signal: AbortSignal,
): Promise<LocalShareJob> {
  const value = await json("actions", token, signal, action);
  if (!isJob(value))
    throw new LocalShareError(
      "unavailable",
      "Could not start sharing. Refresh to check its status.",
    );
  return value;
}
export async function shareJob(
  token: string,
  id: string,
  signal: AbortSignal,
): Promise<LocalShareJob> {
  const value = await json(`jobs/${encodeURIComponent(id)}`, token, signal);
  if (!isJob(value))
    throw new LocalShareError(
      "unavailable",
      "Could not read sharing progress. Refresh to check its status.",
    );
  return value;
}
export function safeShareUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function optionalFailure(value: unknown): boolean {
  return value === undefined || nullableText(value);
}

function nullableAudience(value: unknown): boolean {
  return value === null || isAudience(value);
}
