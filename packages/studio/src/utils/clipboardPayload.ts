import {
  tagsOutsideCommentsAndRawText,
  type SourceTag,
} from "@hyperframes/core/compiler/html-document";

const CLIPBOARD_MARKER = "hyperframes-clipboard:v1";

/** One clip's copied markup plus the original placement needed to preserve
 *  relative offsets and tracks across a group paste. */
export interface TimelineClipboardClip {
  html: string;
  readFrom?: string | null;
  start: number;
  duration: number;
  track: number;
}

export type ClipboardPayload =
  | {
      kind: "timeline-clip";
      clips: TimelineClipboardClip[];
      sourceFile: string;
      projectId?: string;
      copiedInComposition?: string;
    }
  | {
      kind: "dom-element";
      html: string;
      readFrom?: string | null;
      sourceFile: string;
      projectId?: string;
    };

type SerializedPayload = { _marker: string } & ClipboardPayload;

export function serializeClipboardPayload(payload: ClipboardPayload): string {
  const data: SerializedPayload = { _marker: CLIPBOARD_MARKER, ...payload };
  return JSON.stringify(data);
}

// Each branch validates one wire shape at the trust boundary; splitting further
// would fragment one parse into partial validators with no independent reuse.
// fallow-ignore-next-line complexity
export function deserializeClipboardPayload(json: string): ClipboardPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (obj._marker !== CLIPBOARD_MARKER) return null;
  if (typeof obj.sourceFile !== "string") return null;
  if (obj.kind === "timeline-clip") {
    if (!Array.isArray(obj.clips)) return null;
    const clips = obj.clips
      .filter((c): c is TimelineClipboardClip => {
        const clip = c as Partial<TimelineClipboardClip> | null;
        return (
          !!clip &&
          typeof clip === "object" &&
          typeof clip.html === "string" &&
          typeof clip.start === "number" &&
          typeof clip.duration === "number" &&
          typeof clip.track === "number"
        );
      })
      .map(({ html, start, duration, track }) => ({ html, start, duration, track }));
    if (clips.length === 0) return null;
    const projectId = typeof obj.projectId === "string" ? obj.projectId : undefined;
    const copiedInComposition =
      typeof obj.copiedInComposition === "string" ? obj.copiedInComposition : undefined;
    return {
      kind: "timeline-clip",
      clips,
      sourceFile: obj.sourceFile,
      projectId,
      copiedInComposition,
    };
  }
  if (obj.kind === "dom-element") {
    if (typeof obj.html !== "string") return null;
    return {
      kind: "dom-element",
      html: obj.html,
      sourceFile: obj.sourceFile,
      projectId: typeof obj.projectId === "string" ? obj.projectId : undefined,
    };
  }
  return null;
}

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const HF_ID_ATTRIBUTE = /\sdata-hf-id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;

const tagText = (source: string, tag: SourceTag) => source.slice(tag.start, tag.endAfterBracket);
const selfClosing = (source: string, tag: SourceTag) =>
  source.charAt(tag.endAfterBracket - 2) === "/";

/** Just past the end of the element whose start tag is `tags[at]`, or -1 when it never closes. */
function elementEnd(source: string, tags: SourceTag[], at: number): number {
  const open = tags[at]!;
  if (VOID_TAGS.has(open.lowercaseName) || selfClosing(source, open)) return open.endAfterBracket;
  let depth = 0;
  for (const tag of tags.slice(at)) {
    if (tag.lowercaseName !== open.lowercaseName || (!tag.closing && selfClosing(source, tag)))
      continue;
    depth += tag.closing ? -1 : 1;
    if (depth === 0) return tag.endAfterBracket;
  }
  return -1;
}

/**
 * Insert `newHtml` right after the element whose `data-hf-id` is `anchorHfId`, else just inside the composition
 * root, else at the end. Only real tags count: text inside a script, style or comment never anchors it.
 */
export function insertAsSibling(source: string, newHtml: string, anchorHfId?: string): string {
  const tags = [...tagsOutsideCommentsAndRawText(source)];
  if (anchorHfId) {
    const hfIdOf = (tag: SourceTag) => {
      const match = HF_ID_ATTRIBUTE.exec(tagText(source, tag));
      return match && (match[1] ?? match[2] ?? match[3]);
    };
    const at = tags.findIndex((tag) => !tag.closing && hfIdOf(tag) === anchorHfId);
    const end = at < 0 ? -1 : elementEnd(source, tags, at);
    if (end > 0) return source.slice(0, end) + "\n" + newHtml + source.slice(end);
  }
  const root = tags.find(
    (tag) => !tag.closing && /\sdata-composition-id\s*=/i.test(tagText(source, tag)),
  );
  return root
    ? source.slice(0, root.endAfterBracket) + newHtml + source.slice(root.endAfterBracket)
    : source + newHtml;
}
