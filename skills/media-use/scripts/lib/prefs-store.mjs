import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Remembered defaults — the lightweight tier of HyperFrames user memory.
 *
 * Two files, same shape as the rest of media-use's storage split:
 * - project `.media/preferences.json` — committed with the repo, so the whole
 *   team inherits it; written every time a brief answer is confirmed.
 * - user `~/.media/preferences.json` — personal, cross-repo. A key is promoted
 *   here only once the same value has been confirmed in two different projects
 *   (`PROMOTE_AT`), so a one-off choice never pollutes the global defaults.
 *   Pre-promotion evidence accumulates in the user file's `sightings` ledger —
 *   project files can't see each other, so the cross-project count has to live
 *   user-side.
 *
 * Consumption contract (brief-contract § 2, Remembered defaults): a remembered
 * value becomes the recommended option with a receipt naming its source — it
 * never skips a question, and explicit request content always wins.
 */

const PREFS_FILE = "preferences.json";

/** Keys the brief contract records; `style_preset` is stored per workflow. */
export const PREFERENCE_KEYS = [
  "destination",
  "aspect",
  "language",
  "flow",
  "storyboard",
  "voice",
  "style_preset",
];

/** A value must be confirmed in this many distinct projects to go user-tier. */
export const PROMOTE_AT = 2;

export function projectPrefsPath(projectDir) {
  return join(resolve(projectDir), ".media", PREFS_FILE);
}

export function userPrefsPath() {
  return join(homedir(), ".media", PREFS_FILE);
}

function emptyFile() {
  return { version: 1, preferences: {}, sightings: {} };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Tolerant read — a missing or malformed file counts as empty. */
function readPrefsFile(path) {
  try {
    if (!existsSync(path)) return emptyFile();
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(parsed)) return emptyFile();
    return {
      version: 1,
      preferences: isRecord(parsed.preferences) ? parsed.preferences : {},
      sightings: isRecord(parsed.sightings) ? parsed.sightings : {},
    };
  } catch {
    return emptyFile();
  }
}

/** Atomic write (tmp + rename) so a crash never leaves a torn file. */
function writePrefsFile(path, file) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(tmp, path);
}

/** `style_preset` entries are stored per workflow as `style_preset.<workflow>`. */
export function preferenceKeyFor(key, workflow) {
  return key === "style_preset" && workflow ? `style_preset.${workflow}` : key;
}

function validEntry(entry) {
  return isRecord(entry) && typeof entry.value === "string" && entry.value.length > 0;
}

/**
 * The merged view the brief reads: user-tier promoted entries first, project
 * entries on top (project wins). Each entry carries `source` plus the receipt
 * material (`confirmed_in`, `updated_at`).
 */
export function mergedPreferences(projectDir) {
  const user = readPrefsFile(userPrefsPath());
  const project = readPrefsFile(projectPrefsPath(projectDir));
  const merged = {};
  for (const [key, entry] of Object.entries(user.preferences)) {
    if (validEntry(entry)) merged[key] = { ...entry, source: "user" };
  }
  for (const [key, entry] of Object.entries(project.preferences)) {
    if (validEntry(entry)) merged[key] = { ...entry, source: "project" };
  }
  return merged;
}

function dedupe(list) {
  return [...new Set(list)];
}

/**
 * Project tier: same value accumulates confirmations; a changed value starts
 * provenance over (the old confirmations vouched for the old value).
 */
function recordProjectTier(projectDir, fullKey, value, projectName, now) {
  const path = projectPrefsPath(projectDir);
  const file = readPrefsFile(path);
  const previous = file.preferences[fullKey];
  const keepProvenance = validEntry(previous) && previous.value === value;
  const confirmedIn = keepProvenance
    ? dedupe([...(Array.isArray(previous.confirmed_in) ? previous.confirmed_in : []), projectName])
    : [projectName];
  file.preferences[fullKey] = { value, confirmed_in: confirmedIn, updated_at: now };
  writePrefsFile(path, file);
  return confirmedIn;
}

/**
 * User tier: accumulate this sighting in the ledger, and promote the key once
 * the same value has been confirmed in PROMOTE_AT distinct projects.
 */
function recordUserSighting(fullKey, value, projectName, now) {
  const path = userPrefsPath();
  const file = readPrefsFile(path);
  const keySightings = isRecord(file.sightings[fullKey]) ? file.sightings[fullKey] : {};
  const seenIn = dedupe([
    ...(Array.isArray(keySightings[value]) ? keySightings[value] : []),
    projectName,
  ]);
  keySightings[value] = seenIn;
  file.sightings[fullKey] = keySightings;
  const promoted = seenIn.length >= PROMOTE_AT;
  if (promoted) {
    file.preferences[fullKey] = { value, confirmed_in: seenIn, updated_at: now };
  }
  writePrefsFile(path, file);
  return promoted;
}

/**
 * Record one confirmed brief answer. Always writes the project tier; feeds the
 * user tier's sightings ledger and promotes once the same value has been
 * confirmed in PROMOTE_AT distinct projects. Idempotent per project.
 */
export function recordPreference({ projectDir, key, value, workflow }) {
  if (!PREFERENCE_KEYS.includes(key)) {
    throw new Error(`unknown preference key: "${key}" (known: ${PREFERENCE_KEYS.join(", ")})`);
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("a preference needs a non-empty string value");
  }
  if (key === "style_preset" && (!workflow || !String(workflow).trim())) {
    throw new Error("style_preset is stored per workflow — pass --workflow <w>");
  }
  const fullKey = preferenceKeyFor(key, workflow);
  const projectName = basename(resolve(projectDir));
  const trimmed = value.trim();
  const now = new Date().toISOString();

  const confirmedIn = recordProjectTier(projectDir, fullKey, trimmed, projectName, now);

  // Best-effort — a read-only home directory must never fail a brief.
  let promoted = false;
  try {
    promoted = recordUserSighting(fullKey, trimmed, projectName, now);
  } catch {
    // The project record already landed; promotion just waits for next time.
  }

  return { key: fullKey, value: trimmed, confirmed_in: confirmedIn, promoted };
}
