/**
 * Authoring-skill slug helpers, shared by the `events` and `render` commands.
 *
 * A skill slug names the authoring workflow that drove a telemetry event
 * (e.g. "product-launch-video"). Values are slug-gated so a caller can't push
 * high-cardinality or PII strings (paths, shell output, free text) into the
 * anonymous event stream.
 */

/** Lowercase slug: starts alphanumeric, then alphanumerics/hyphens, max 64 chars. */
export const SKILL_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Trim and validate a raw `--skill` value. Returns the slug, or `undefined`
 * when the value is missing or not a valid slug (so the telemetry property is
 * simply omitted rather than carrying garbage).
 */
export function normalizeSkillSlug(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const slug = raw.trim();
  return SKILL_SLUG.test(slug) ? slug : undefined;
}
