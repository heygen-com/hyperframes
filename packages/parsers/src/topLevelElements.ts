/** Structural view of a markup node; lint (source tags) and Studio (DOM) adapt to it. */
export type StructureNode<N = unknown> = {
  tag: string;
  attrs: Readonly<Record<string, string | undefined>>;
  children: readonly N[];
};

export type TrackKind = "video" | "audio" | "captions" | "graphics";
export type TrackKindSource = "attribute" | "tag" | "legacy-captions" | "sub-composition";

const NON_RENDERED_TAGS = new Set(["script", "style", "template", "link", "meta"]);
const TRACK_KINDS: readonly string[] = ["video", "audio", "captions", "graphics"];

export function isSubCompositionHost(node: StructureNode): boolean {
  return (
    node.attrs["data-composition-src"] !== undefined ||
    node.attrs["data-composition-id"] !== undefined
  );
}

export function isTimedElement(node: StructureNode): boolean {
  const { attrs, tag } = node;
  return (
    attrs["data-start"] !== undefined ||
    attrs["data-duration"] !== undefined ||
    tag === "video" ||
    tag === "audio" ||
    /(?:^|\s)clip(?:\s|$)/.test(attrs.class ?? "")
  );
}

/**
 * The elements that own a timeline row: a sub-composition host or timed element is one row
 * and is never descended into; untimed wrappers are descended. The root itself is not a row.
 */
export function topLevelElements<N extends StructureNode<N>>(root: N): N[] {
  const rows: N[] = [];
  const visit = (node: N): void => {
    if (NON_RENDERED_TAGS.has(node.tag)) return;
    if (isSubCompositionHost(node) || isTimedElement(node)) rows.push(node);
    else node.children.forEach(visit);
  };
  root.children.forEach(visit);
  return rows;
}

export function trackKindOf(node: StructureNode): { kind: TrackKind; source: TrackKindSource } {
  const explicit = node.attrs["data-track-kind"]?.trim().toLowerCase();
  if (explicit && TRACK_KINDS.includes(explicit))
    return { kind: explicit as TrackKind, source: "attribute" };
  if (node.tag === "video" || node.tag === "audio") return { kind: node.tag, source: "tag" };
  if (isSubCompositionHost(node)) {
    const legacy =
      node.attrs["data-composition-id"] === "captions" ||
      /(?:^|\s)caption[-_]/.test(node.attrs.class ?? "");
    return legacy
      ? { kind: "captions", source: "legacy-captions" }
      : { kind: "graphics", source: "sub-composition" };
  }
  return { kind: "graphics", source: "tag" };
}
