/**
 * Return the alpha channel of a CSS functional colour.
 *
 * Browsers serialize computed colours as rgb()/rgba(), but accepting hsl()/hsla()
 * too keeps this helper useful for test doubles and authored values. Unknown colour
 * syntaxes are treated as opaque because they may still paint.
 *
 * Keep this function self-contained: the CLI serializes it into its standalone
 * browser audit script so that browser-side paint checks share this exact parser.
 */
export function cssColorAlpha(value: string): number {
  if (!value) return 1;
  if (value.trim().toLowerCase() === "transparent") return 0;

  const match = /^(?:rgba?|hsla?)\(([^)]*)\)$/i.exec(value.trim());
  if (!match) return 1;

  const body = match[1] ?? "";
  let rawAlpha: string | undefined;
  const slash = body.lastIndexOf("/");
  if (slash >= 0) {
    rawAlpha = body.slice(slash + 1).trim();
  } else {
    const commaParts = body.split(",");
    if (commaParts.length === 4) rawAlpha = commaParts[3]?.trim();
  }

  if (!rawAlpha) return 1;
  const percentage = rawAlpha.endsWith("%");
  const parsed = Number.parseFloat(rawAlpha);
  if (!Number.isFinite(parsed)) return 1;
  const alpha = percentage ? parsed / 100 : parsed;
  return Math.min(1, Math.max(0, alpha));
}

/** Whether a CSS colour contributes no painted pixels. */
export function isTransparentColor(value: string): boolean {
  return !value || cssColorAlpha(value) === 0;
}
