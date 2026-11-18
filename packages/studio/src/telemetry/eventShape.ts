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
]);
const SELECTOR_KEYS = new Set(["target_selector", "selector", "target_id", "animationId"]);
const MESSAGE_KEYS = new Set(["error_message", "error", "render_error", "render_stage"]);
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

function messageFacts(key: string, value: string): Facts {
  const line = redactTelemetryString(value.split("\n", 1)[0] ?? "", Number.MAX_SAFE_INTEGER)
    .replace(/\b(?:https?|blob|data|file|[a-z-]+-extension):\S*/gi, "<url>")
    .replace(/(^|[\s(])[#.][A-Za-z_][\w-]*/g, "$1<sel>")
    .replace(/(["'`]).*?\1/g, "?")
    .replace(/\d+/g, "#");
  const status = /(?:\(|HTTP |status |failed: )([1-5]\d\d)\b/.exec(value)?.[1];
  return {
    [`${key}_shape`]: hashOf(line),
    ...(status ? { [`${key}_status`]: Number(status) } : {}),
  };
}

function bundleFile(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const at = new URL(url);
    if (at.origin !== location.origin || at.pathname.startsWith("/api/")) return null;
    const name = at.pathname.split("/").pop() ?? "";
    return /^[\w.-]+\.(?:m?js|tsx?|jsx?)$/.test(name) ? name : null;
  } catch {
    return null;
  }
}

const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
const GECKO_FRAME = /^(.*?)@(.+?):(\d+):(\d+)\s*$/;

function shapedFrames(stack: string): string {
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    const m = V8_FRAME.exec(line) ?? GECKO_FRAME.exec(line);
    if (!m) continue;
    const file = bundleFile(m[2] ?? "");
    frames.push(file ? `${m[1]?.trim() || "<anonymous>"}@${file}:${m[3]}:${m[4]}` : "?");
    if (frames.length === 20) break;
  }
  return frames.join("\n");
}

const componentNames = (stack: string): string =>
  [...stack.matchAll(/^\s*(?:at|in)\s+([A-Za-z_$][\w$.]*)/gm)]
    .slice(0, 30)
    .map((m) => m[1])
    .join("\n");

const ATTRIBUTE_SELECTOR = /\[[\w:-]+(?:[~|^$*]?=[^\]]*)?\]/;
const ID_OR_CLASS = /^\s*[#.][A-Za-z_-][\w-]*/;
const HEX_COLOUR = /^#[0-9a-f]{3,8}$/i;

function readsAsPathOrSelector(value: string): boolean {
  if (redactTelemetryString(value, Number.MAX_SAFE_INTEGER) !== value) return true;
  return (
    ATTRIBUTE_SELECTOR.test(value) || (ID_OR_CLASS.test(value) && !HEX_COLOUR.test(value.trim()))
  );
}

type Shaper = (key: string, value: string) => Facts | null;
const single =
  (shape: (value: string) => string | null): Shaper =>
  (key, value) => {
    const shaped = shape(value);
    return shaped === null ? null : { [key]: shaped };
  };
const otherValue: Shaper = (key, value) => (readsAsPathOrSelector(value) ? null : { [key]: value });
const SHAPERS: Record<string, Shaper> = {
  ...Object.fromEntries([...MESSAGE_KEYS].map((key) => [key, messageFacts])),
  ...Object.fromEntries([...PATH_KEYS].map((key) => [key, pathFacts])),
  ...Object.fromEntries([...SELECTOR_KEYS].map((key) => [key, selectorFacts])),
  stack_trace: single(shapedFrames),
  component_stack: single(componentNames),
  filename: single(bundleFile),
};

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
      continue;
    }
    const facts = (SHAPERS[key] ?? otherValue)(key, value);
    if (facts) Object.assign(out, facts);
    else dropped.push(key);
  }
  if (dropped.length > 0) out.dropped_fields = dropped.join(",");
  return out;
}
