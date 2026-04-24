/**
 * Sub-compositions wrap their content in a <template> tag. linkedom follows the
 * browser contract where querySelectorAll does not descend into template content
 * (it's a separate DocumentFragment), so media elements inside the wrapper are
 * invisible to a plain DOM scrape. Unwrap one level of <template> if present so
 * sub-composition media get parsed alongside main-composition media.
 *
 * Assumes at most one top-level <template> per input. The greedy match runs
 * from the first `<template>` to the last `</template>`, which correctly peels
 * a single wrapper (even when its content contains a nested <template>, e.g. a
 * cloning template inside the composition DOM). It does NOT handle inputs with
 * multiple sibling top-level <template>s — `<template>a</template>b<template>c</template>`
 * collapses to `a</template>b<template>c`, which is wrong. Sub-composition
 * HTML authored via the documented convention has exactly one wrapper, so
 * this caveat doesn't surface in the render pipeline; callers producing
 * different shapes need their own parser.
 */
export function unwrapTemplate(html: string): string {
  const match = html.match(/<template[^>]*>([\s\S]*)<\/template>/i);
  // Check match[1] against undefined specifically — an empty template
  // produces `match[1] === ""`, which a truthiness check would treat as
  // "no match found" and fall through to the original html.
  return match && match[1] !== undefined ? match[1] : html;
}
