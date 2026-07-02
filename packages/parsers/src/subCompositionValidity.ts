/**
 * Shared "is this sub-composition file usable?" check.
 *
 * `data-composition-src` files are authored by AI agents far more often than
 * by humans clicking a UI. The dominant real-world failure is a scene worker
 * that dies mid-write (or a step that references a scene before writing it),
 * leaving an empty or partial `compositions/scene-*.html` on disk. Historically
 * this surfaced in three different ways depending on which code path touched
 * the file first:
 *
 *   1. A raw crash inside linkedom's `Document.head` getter — destructuring
 *      `firstElementChild` off a `null` `documentElement` — when the file is
 *      empty or contains no parseable markup.
 *   2. An actionable-but-late `Error` thrown deep inside the render compiler
 *      (see git history: #1364), which aborted the whole render.
 *   3. A silent skip (see git history: #1678) that drops the scene from the
 *      output with only a `console.warn`, producing a materially broken
 *      video (missing scene, no error surfaced anywhere) with no clear
 *      signal to the caller.
 *
 * This module gives every consumer (lint, render pre-flight, the tolerant
 * inliner) a single, shared definition of "usable" so they can never
 * disagree about whether a given file would render something. It lives in
 * `@hyperframes/parsers` (rather than `@hyperframes/core`, where it
 * originated) because `@hyperframes/lint` needs it too, and `lint` cannot
 * depend on `core` — `core` already depends on `lint` — so this shared,
 * dependency-free check lives in the common ancestor package both `core`
 * and `lint` already depend on.
 *
 * `inlineSubCompositions.ts` (in `@hyperframes/core`) intentionally stays
 * tolerant (skip + continue) for the preview/studio bundling path, where
 * partial content while iterating is expected. `lint` and the render
 * pre-flight check (`packages/producer/src/services/htmlCompiler.ts`) use
 * this helper to fail loudly and name the exact offending file, because a
 * render that silently drops a scene is strictly worse than a render that
 * refuses to start.
 */

export type SubCompositionValidityReason =
  | "empty"
  | "unparsable"
  | "no-content"
  | "no-composition-root";

export interface SubCompositionValidity {
  ok: boolean;
  /** Present when `ok` is false. */
  reason?: SubCompositionValidityReason;
  /** Human-readable detail suitable for direct inclusion in an error message. */
  detail?: string;
}

/** Minimal shape both linkedom's `Document` and `happy-dom`'s satisfy. */
export interface ParsableDocumentLike {
  documentElement: { outerHTML?: string } | null;
  body?: { innerHTML?: string | null } | null;
  querySelector(selector: string): { innerHTML?: string | null } | null;
}

/**
 * Check whether `html` (the raw file contents resolved for a
 * `data-composition-src` reference) is non-empty and parses to a document
 * that actually contains renderable content.
 *
 * Mirrors the content-detection steps in `inlineSubCompositions` exactly
 * (resolve → parse → find `<template>` or `<body>` content → parse that →
 * confirm a `[data-composition-id]` root exists in it), so a file that
 * passes this check is guaranteed to produce non-empty output from the
 * inliner, and a file that fails it is guaranteed to hit one of the
 * inliner's `onMissingComposition` branches.
 *
 * @param html Raw file contents, or `null`/`undefined` if the file could not
 *   be read (e.g. missing from disk). Callers should distinguish "missing"
 *   from "empty" in their own error message using a separate existence
 *   check — this function only inspects content.
 * @param parseHtml Parse an HTML string into a document. Pass linkedom's
 *   `parseHTML(html).document` or the core bundler's `parseHTMLContent`.
 */
export function checkSubCompositionUsability(
  html: string | null | undefined,
  parseHtml: (html: string) => ParsableDocumentLike,
): SubCompositionValidity {
  if (html == null || !html.trim()) {
    return {
      ok: false,
      reason: "empty",
      detail: "the file is empty (0 bytes or whitespace-only)",
    };
  }

  const compDoc = parseHtml(html);
  if (!compDoc.documentElement) {
    return {
      ok: false,
      reason: "unparsable",
      detail: "the file's contents could not be parsed as HTML",
    };
  }

  // Find content: prefer <template>, fall back to <body> — same precedence
  // inlineSubCompositions uses when extracting the sub-composition's markup.
  const contentRoot = compDoc.querySelector("template");
  const contentHtml = contentRoot ? contentRoot.innerHTML || "" : compDoc.body?.innerHTML || "";
  if (!contentHtml.trim()) {
    return {
      ok: false,
      reason: "no-content",
      detail: "the file has no <template> or <body> content to render",
    };
  }

  const contentDoc = parseHtml(contentHtml);
  if (!contentDoc.documentElement) {
    return {
      ok: false,
      reason: "unparsable",
      detail: "the file's <template>/<body> contents could not be parsed as HTML",
    };
  }

  // The content must contain an actual composition root — the element the
  // inliner looks for (`contentDoc.querySelector("[data-composition-id]")`)
  // to know what to inject into the host. Well-formed but marker-free HTML
  // (e.g. an AI-authored placeholder like `<body><p>TODO</p></body>`) parses
  // fine and has non-empty content, but has nothing for the inliner to find.
  if (!contentDoc.querySelector("[data-composition-id]")) {
    return {
      ok: false,
      reason: "no-composition-root",
      detail:
        "the file's <template>/<body> content has no element with a data-composition-id attribute",
    };
  }

  return { ok: true };
}
