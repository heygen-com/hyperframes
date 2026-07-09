export const VARIABLES_ATTR = "variables";

export type HyperframesVariables = Record<string, unknown>;

function escapeScriptJson(json: string): string {
  return json.replace(/</g, "\\u003C");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function isPlainObject(value: unknown): value is HyperframesVariables {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseVariablesAttribute(value: string | null): HyperframesVariables | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function serializeVariablesAttribute(variables: HyperframesVariables): string {
  return JSON.stringify(variables) ?? "{}";
}

export function injectVariablesIntoSrcdoc(html: string, variables: HyperframesVariables): string {
  const json = escapeScriptJson(JSON.stringify(variables) ?? "{}");
  const script = `<script data-hyperframes-player-variables>window.__hfVariables = ${json};</script>`;
  if (/<head\b[^>]*>\s*<base\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>\s*<base\b[^>]*>/i, (match) => `${match}${script}`);
  }
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}${script}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, (match) => `${match}${script}`);
  }
  return `${script}${html}`;
}

export function resolveUrl(src: string, base: string): URL | null {
  try {
    return new URL(src, base);
  } catch {
    return null;
  }
}

export function isSameOriginUrl(src: string, base: string): boolean {
  const resolved = resolveUrl(src, base);
  const resolvedBase = resolveUrl(base, base);
  return resolved !== null && resolvedBase !== null && resolved.origin === resolvedBase.origin;
}

export function injectBaseHrefIntoSrcdoc(html: string, href: string): string {
  if (/<base\b[^>]*>/i.test(html)) return html;
  const base = `<base href="${escapeHtmlAttribute(href)}">`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}${base}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, (match) => `${match}<head>${base}</head>`);
  }
  return `<head>${base}</head>${html}`;
}
