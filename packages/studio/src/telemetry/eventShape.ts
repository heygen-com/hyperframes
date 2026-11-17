// The one place Studio's event values are shaped before they leave the machine, for both
// transports. A path or a selector becomes facts that still group and debug (extension, kind,
// depth, a per-install hash); any other value that reads as one is dropped and named.
import { redactTelemetryString } from "@hyperframes/core/telemetry-redaction";
import { hashContent } from "../hooks/sdkSelfWriteRegistry";

type Value = string | number | boolean | null | undefined;
type Facts = Record<string, string | number>;

const PATH_KEYS = new Set([
  "file_path",
  "target_source_file",
  "source_file",
  "path",
  "composition",
  "render_composition",
  "filename",
]);
const SELECTOR_KEYS = new Set(["target_selector", "selector", "target_id", "animationId"]);
// Text the person typed to send to us on purpose.
const KEPT_AS_TYPED: Record<string, ReadonlySet<string>> = {
  studio_feedback: new Set(["comment"]),
};

const SALT_KEY = "hyperframes-studio:telemetrySalt";
let sessionSalt: string | undefined;

function newSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Kept on this install and never sent: a hash groups repeats here but names nothing elsewhere. */
function installSalt(): string {
  try {
    const saved = localStorage.getItem(SALT_KEY);
    if (saved && /^[0-9a-f]{32}$/.test(saved)) return saved;
    const salt = newSalt();
    localStorage.setItem(SALT_KEY, salt);
    return salt;
  } catch {
    sessionSalt ??= newSalt();
    return sessionSalt;
  }
}

// ponytail: 32-bit FNV-1a groups one install's repeats; a collision only merges two groups.
const hashOf = (value: string): string =>
  hashContent(`${installSalt()}\0${value}`).padStart(8, "0");

const KINDS: Record<string, string> = {
  html: "composition",
  htm: "composition",
  js: "script",
  mjs: "script",
  cjs: "script",
  ts: "script",
  tsx: "script",
  jsx: "script",
  css: "style",
  scss: "style",
  less: "style",
};

function pathFacts(key: string, value: string): Facts {
  const paths = value.split(",").filter((p) => p.trim().length > 0);
  const first = paths[0] ?? value;
  const segments = first.split(/[\\/]/).filter(Boolean);
  const name = segments.at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  const raw = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const ext = /^[a-z0-9]{1,8}$/.test(raw) ? raw : "none";
  const kind = ext === "none" ? "other" : (KINDS[ext] ?? "asset");
  return {
    [`${key}_ext`]: ext,
    [`${key}_kind`]: kind,
    [`${key}_depth`]: Math.max(segments.length - 1, 0),
    [`${key}_hash`]: hashOf(first),
    ...(paths.length > 1 ? { [`${key}_count`]: paths.length } : {}),
  };
}

function selectorFacts(key: string, value: string): Facts {
  const s = value.trim();
  const kind =
    key === "target_id"
      ? "id"
      : s.startsWith("#")
        ? "id"
        : s.startsWith(".")
          ? "class"
          : s.startsWith("[")
            ? "attribute"
            : "other";
  return { [`${key}_kind`]: kind, [`${key}_hash`]: hashOf(s) };
}

const ATTRIBUTE_SELECTOR = /\[[\w:-]+(?:[~|^$*]?=[^\]]*)?\]/;
const ID_OR_CLASS = /^\s*[#.][A-Za-z_-][\w-]*/;
const HEX_COLOUR = /^#[0-9a-f]{3,8}$/i;

function readsAsPathOrSelector(value: string): boolean {
  if (redactTelemetryString(value, Number.MAX_SAFE_INTEGER) !== value) return true;
  return (
    ATTRIBUTE_SELECTOR.test(value) || (ID_OR_CLASS.test(value) && !HEX_COLOUR.test(value.trim()))
  );
}

/** A caller's properties as they may leave the machine; runs before the transport's own fields. */
export function shapeEventProperties<V extends Value>(
  event: string,
  properties: Record<string, V>,
): Record<string, V | string | number> {
  const kept = KEPT_AS_TYPED[event];
  const out: Record<string, V | string | number> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value !== "string" || value === "" || kept?.has(key)) {
      out[key] = value;
    } else if (PATH_KEYS.has(key)) {
      Object.assign(out, pathFacts(key, value));
    } else if (SELECTOR_KEYS.has(key)) {
      Object.assign(out, selectorFacts(key, value));
    } else if (readsAsPathOrSelector(value)) {
      dropped.push(key);
    } else {
      out[key] = value;
    }
  }
  if (dropped.length > 0) out.dropped_fields = dropped.join(",");
  return out;
}
