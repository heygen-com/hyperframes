// ---------------------------------------------------------------------------
// LocalStorage-backed config for studio telemetry.
// Anonymous ID + opt-out flag are stored per-browser-profile.
// Users opt out via DevTools:
//   localStorage.setItem('hyperframes-studio:telemetryDisabled','1')
// ---------------------------------------------------------------------------

const ANON_ID_KEY = "hyperframes-studio:anonymousId";
const OPT_OUT_KEY = "hyperframes-studio:telemetryDisabled";
const NOTICE_KEY = "hyperframes-studio:telemetryNoticeShown";

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function newAnonymousId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `anon-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getAnonymousId(): string {
  const ls = safeLocalStorage();
  if (!ls) return "anonymous";
  const existing = ls.getItem(ANON_ID_KEY);
  if (existing) return existing;
  const id = newAnonymousId();
  try {
    ls.setItem(ANON_ID_KEY, id);
  } catch {
    /* private browsing / quota — return the in-memory ID for this session */
  }
  return id;
}

export function isOptedOut(): boolean {
  return safeLocalStorage()?.getItem(OPT_OUT_KEY) === "1";
}

export function hasShownNotice(): boolean {
  return safeLocalStorage()?.getItem(NOTICE_KEY) === "1";
}

export function markNoticeShown(): void {
  try {
    safeLocalStorage()?.setItem(NOTICE_KEY, "1");
  } catch {
    /* ignore */
  }
}

// Session-scoped (cleared when the tab closes) so HMR remounts and
// route-level remounts within one tab don't refire `studio_session_start`.
// Uses sessionStorage directly because the dedupe is per-tab, not per-browser.
const SESSION_FIRED_KEY = "hyperframes-studio:sessionStartFired";

function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function hasFiredSessionStart(): boolean {
  return safeSessionStorage()?.getItem(SESSION_FIRED_KEY) === "1";
}

export function markSessionStartFired(): void {
  try {
    safeSessionStorage()?.setItem(SESSION_FIRED_KEY, "1");
  } catch {
    /* ignore */
  }
}
