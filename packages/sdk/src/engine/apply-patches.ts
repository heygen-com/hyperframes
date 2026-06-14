/**
 * Bounded RFC 6902 patch applier — handles only the path patterns emitted by mutate.ts.
 *
 * Not a general-purpose JSON Patch implementation. Translates the well-defined path
 * grammar back into DOM mutations. Used by applyPatches() for host undo (T3 mode).
 *
 * Supports only the emit subset (add/remove/replace) — move/copy/test ops and
 * unknown paths are silently ignored, matching the JsonPatchOp contract.
 */

import type { JsonPatchOp, OverrideSet } from "../types.js";
import type { ParsedDocument } from "./model.js";
import {
  findById,
  findRoot,
  setElementStyles,
  setOwnText,
  setGsapScript,
  setStyleSheet,
} from "./model.js";
import { keyToPath } from "./patches.js";

// ─── Path parser ────────────────────────────────────────────────────────────

interface ParsedPath {
  type:
    | "style"
    | "text"
    | "attribute"
    | "timing"
    | "hold"
    | "element"
    | "variable"
    | "metadata"
    | "script"
    | "stylesheet";
  id?: string;
  prop?: string;
  field?: string;
}

// fallow-ignore-next-line complexity
function parsePath(path: string): ParsedPath | null {
  const styleM = /^\/elements\/([^/]+)\/inlineStyles\/(.+)$/.exec(path);
  if (styleM) return { type: "style", id: styleM[1], prop: styleM[2] };

  const textM = /^\/elements\/([^/]+)\/text$/.exec(path);
  if (textM) return { type: "text", id: textM[1] };

  const attrM = /^\/elements\/([^/]+)\/attributes\/(.+)$/.exec(path);
  if (attrM)
    return {
      type: "attribute",
      id: attrM[1],
      prop: attrM[2]?.replace(/~1/g, "/").replace(/~0/g, "~"),
    };

  const timingM = /^\/elements\/([^/]+)\/timing\/(.+)$/.exec(path);
  if (timingM) return { type: "timing", id: timingM[1], field: timingM[2] };

  const holdM = /^\/elements\/([^/]+)\/hold\/(.+)$/.exec(path);
  if (holdM) return { type: "hold", id: holdM[1], field: holdM[2] };

  const elemM = /^\/elements\/([^/]+)$/.exec(path);
  if (elemM) return { type: "element", id: elemM[1] };

  const varM = /^\/variables\/(.+)$/.exec(path);
  if (varM) return { type: "variable", id: varM[1] };

  const metaM = /^\/metadata\/(.+)$/.exec(path);
  if (metaM) return { type: "metadata", field: metaM[1] };

  if (path === "/script/gsap") return { type: "script" };
  if (path === "/style/css") return { type: "stylesheet" };

  return null;
}

// ─── Patch application ───────────────────────────────────────────────────────

/**
 * Replay a stored override-set onto a freshly-parsed base document (T3 init).
 * A null value means the property was explicitly deleted — emit a remove patch
 * so the base document matches the session state. (Removing a non-existent
 * property is a no-op in applyOne, so this is safe against fresh-base misses.)
 */
export function applyOverrideSet(parsed: ParsedDocument, overrides: OverrideSet): void {
  const patches: JsonPatchOp[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    const path = keyToPath(key);
    if (!path) continue;
    if (value === null) {
      patches.push({ op: "remove", path });
      continue;
    }
    patches.push({ op: "replace", path, value });
  }
  applyPatchesToDocument(parsed, patches);
}

export function applyPatchesToDocument(
  parsed: ParsedDocument,
  patches: readonly JsonPatchOp[],
): void {
  for (const patch of patches) {
    const p = parsePath(patch.path);
    if (!p) continue;
    applyOne(parsed, patch, p);
  }
}

// fallow-ignore-next-line complexity
function applyOne(parsed: ParsedDocument, patch: JsonPatchOp, p: ParsedPath): void {
  switch (p.type) {
    case "style": {
      const el = p.id ? findById(parsed.document, p.id) : null;
      if (!el || !p.prop) return;
      if (patch.op === "remove") {
        setElementStyles(el, { [p.prop]: null });
      } else {
        setElementStyles(el, { [p.prop]: String(patch.value) });
      }
      break;
    }

    case "text": {
      const el = p.id ? findById(parsed.document, p.id) : null;
      if (!el) return;
      if (patch.op === "remove") {
        setOwnText(el, "");
      } else {
        setOwnText(el, String(patch.value ?? ""));
      }
      break;
    }

    case "attribute": {
      const el = p.id ? findById(parsed.document, p.id) : null;
      if (!el || !p.prop) return;
      if (patch.op === "remove") {
        el.removeAttribute(p.prop);
      } else {
        el.setAttribute(p.prop, String(patch.value ?? ""));
      }
      break;
    }

    case "timing": {
      const el = p.id ? findById(parsed.document, p.id) : null;
      if (!el || !p.field) return;
      if (p.field === "start") {
        if (patch.op === "remove") el.removeAttribute("data-start");
        else el.setAttribute("data-start", String(patch.value));
      } else if (p.field === "end") {
        // Patch value is the absolute data-end time — set directly, no re-derivation.
        if (patch.op === "remove") el.removeAttribute("data-end");
        else el.setAttribute("data-end", String(patch.value));
      } else if (p.field === "trackIndex") {
        if (patch.op === "remove") el.removeAttribute("data-track-index");
        else el.setAttribute("data-track-index", String(patch.value));
      }
      break;
    }

    case "hold": {
      const el = p.id ? findById(parsed.document, p.id) : null;
      if (!el || !p.field) return;
      const attrName = `data-hold-${p.field}`;
      if (patch.op === "remove") el.removeAttribute(attrName);
      else el.setAttribute(attrName, String(patch.value));
      break;
    }

    case "element": {
      if (!p.id) return;
      if (patch.op === "remove") {
        const el = findById(parsed.document, p.id);
        el?.remove();
      } else if (patch.op === "add" && patch.value) {
        const v = patch.value as { html: string; parentId: string | null; siblingIndex: number };
        const parent = v.parentId
          ? findById(parsed.document, v.parentId)
          : ((parsed.document as unknown as { body: Element }).body as unknown as Element);
        if (!parent) return;
        // Parse within the target document to avoid cross-document node issues.
        const tmp = parsed.document.createElement("div");
        tmp.innerHTML = v.html;
        const node = tmp.firstElementChild;
        if (!node) return;
        const children = Array.from(parent.children);
        const ref = children[v.siblingIndex] ?? null;
        parent.insertBefore(node, ref);
      }
      break;
    }

    case "variable": {
      const root = findRoot(parsed.document);
      if (!root || !p.id) return;
      const cssVar = `--${p.id}`;
      if (patch.op === "remove") {
        setElementStyles(root, { [cssVar]: null });
      } else {
        setElementStyles(root, { [cssVar]: String(patch.value) });
      }
      break;
    }

    case "script": {
      if (patch.op === "remove") {
        setGsapScript(parsed.document, "");
      } else {
        setGsapScript(parsed.document, String(patch.value ?? ""));
      }
      break;
    }

    case "stylesheet": {
      if (patch.op === "remove") {
        setStyleSheet(parsed.document, "");
      } else {
        setStyleSheet(parsed.document, String(patch.value ?? ""));
      }
      break;
    }

    case "metadata": {
      const root = findRoot(parsed.document);
      if (!root || !p.field) return;
      // Mirror mutate.ts: style always written; the data-* forced-override
      // attribute is updated only when the composition already carries it.
      if (p.field === "width") {
        if (patch.op === "remove") {
          setElementStyles(root, { width: null });
          root.removeAttribute("data-width");
        } else {
          setElementStyles(root, { width: `${patch.value}px` });
          if (root.hasAttribute("data-width")) root.setAttribute("data-width", String(patch.value));
        }
      } else if (p.field === "height") {
        if (patch.op === "remove") {
          setElementStyles(root, { height: null });
          root.removeAttribute("data-height");
        } else {
          setElementStyles(root, { height: `${patch.value}px` });
          if (root.hasAttribute("data-height")) {
            root.setAttribute("data-height", String(patch.value));
          }
        }
      } else if (p.field === "duration") {
        if (patch.op === "remove") root.removeAttribute("data-duration");
        else root.setAttribute("data-duration", String(patch.value));
      }
      break;
    }
  }
}
