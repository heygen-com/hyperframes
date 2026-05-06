import type { HyperframeLintFinding, HyperframeLintResult, HyperframeLinterOptions } from "./types";
import { buildLintContext } from "./context";
import { readAttr, truncateSnippet } from "./utils";
import { coreRules } from "./rules/core";
import { mediaRules } from "./rules/media";
import { gsapRules } from "./rules/gsap";
import { captionRules } from "./rules/captions";
import { compositionRules } from "./rules/composition";
import { adapterRules } from "./rules/adapters";
import { textureRules } from "./rules/textures";

const ALL_RULES = [
  ...coreRules,
  ...mediaRules,
  ...gsapRules,
  ...captionRules,
  ...compositionRules,
  ...adapterRules,
  ...textureRules,
];

export function lintHyperframeHtml(
  html: string,
  options: HyperframeLinterOptions = {},
): HyperframeLintResult {
  const ctx = buildLintContext(html, options);
  const findings: HyperframeLintFinding[] = [];
  const seen = new Set<string>();

  for (const rule of ALL_RULES) {
    for (const finding of rule(ctx)) {
      const dedupeKey = [
        finding.code,
        finding.severity,
        finding.selector || "",
        finding.elementId || "",
        finding.message,
      ].join("|");
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      findings.push(options.filePath ? { ...finding, file: options.filePath } : finding);
    }
  }

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const infoCount = findings.filter((f) => f.severity === "info").length;

  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    findings,
  };
}

// ── Async media URL accessibility checker ─────────────────────────────────

function extractMediaUrls(html: string): Array<{
  url: string;
  tagName: string;
  elementId?: string;
  snippet: string;
}> {
  const results: Array<{
    url: string;
    tagName: string;
    elementId?: string;
    snippet: string;
  }> = [];
  const tagRe = /<(video|audio|img|source)\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    const tagName = (match[1] ?? "").toLowerCase();
    const raw = match[0];
    const src = readAttr(raw, "src");
    if (!src) continue;
    if (/^https?:\/\//i.test(src)) {
      results.push({
        url: src,
        tagName,
        elementId: readAttr(raw, "id") || undefined,
        snippet: truncateSnippet(raw) ?? "",
      });
    }
  }
  return results;
}

/**
 * Async lint pass: HEAD-checks every remote media URL in the HTML.
 * Returns findings for URLs that are unreachable (non-2xx status or network error).
 *
 * Call this after `lintHyperframeHtml()` and merge the findings.
 *
 * @param timeoutMs - per-request timeout (default 8000ms)
 */
export async function lintMediaUrls(
  html: string,
  options: { timeoutMs?: number } = {},
): Promise<HyperframeLintFinding[]> {
  const urls = extractMediaUrls(html);
  if (urls.length === 0) return [];

  const timeout = options.timeoutMs ?? 8000;
  const findings: HyperframeLintFinding[] = [];

  const seen = new Set<string>();
  const unique = urls.filter((u) => {
    if (seen.has(u.url)) return false;
    seen.add(u.url);
    return true;
  });

  const checks = unique.map(async ({ url, tagName, elementId, snippet }) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const resp = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      if (!resp.ok) {
        findings.push({
          code: "inaccessible_media_url",
          severity: "error",
          message: `<${tagName}${elementId ? ` id="${elementId}"` : ""}> references a URL that returned HTTP ${resp.status}: ${url.slice(0, 100)}`,
          elementId,
          fixHint: "This URL is not accessible. Replace with a valid, reachable media URL.",
          snippet,
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.name : "unknown";
      findings.push({
        code: "inaccessible_media_url",
        severity: "error",
        message: `<${tagName}${elementId ? ` id="${elementId}"` : ""}> references an unreachable URL (${reason}): ${url.slice(0, 100)}`,
        elementId,
        fixHint: "This URL is not accessible. Replace with a valid, reachable media URL.",
        snippet,
      });
    }
  });

  await Promise.all(checks);
  return findings;
}

function extractScriptUrls(html: string): Array<{ url: string; snippet: string }> {
  const results: Array<{ url: string; snippet: string }> = [];
  const scriptRe = /<script\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html)) !== null) {
    const raw = match[0];
    const src = readAttr(raw, "src");
    if (!src) continue;
    if (/^https?:\/\//i.test(src)) {
      results.push({
        url: src,
        snippet: truncateSnippet(raw) ?? "",
      });
    }
  }
  return results;
}

/**
 * Async lint pass: HEAD-checks every external script URL in the HTML.
 * Returns findings for URLs that are unreachable (non-2xx status or network error).
 *
 * Call this after `lintHyperframeHtml()` and merge the findings.
 *
 * @param timeoutMs - per-request timeout (default 8000ms)
 */
export async function lintScriptUrls(
  html: string,
  options: { timeoutMs?: number } = {},
): Promise<HyperframeLintFinding[]> {
  const urls = extractScriptUrls(html);
  if (urls.length === 0) return [];

  const timeout = options.timeoutMs ?? 8000;
  const findings: HyperframeLintFinding[] = [];

  const seen = new Set<string>();
  const unique = urls.filter((u) => {
    if (seen.has(u.url)) return false;
    seen.add(u.url);
    return true;
  });

  const checks = unique.map(async ({ url, snippet }) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const resp = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      if (!resp.ok) {
        findings.push({
          code: "inaccessible_script_url",
          severity: "error",
          message: `<script> references a URL that returned HTTP ${resp.status}: ${url.slice(0, 120)}`,
          fixHint:
            "This script URL is not accessible. Remove it or replace with a valid URL. The HyperFrames runtime is injected automatically — do not load it manually.",
          snippet,
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.name : "unknown";
      findings.push({
        code: "inaccessible_script_url",
        severity: "error",
        message: `<script> references an unreachable URL (${reason}): ${url.slice(0, 120)}`,
        fixHint: "This script URL is not accessible. Remove it or replace with a valid URL.",
        snippet,
      });
    }
  });

  await Promise.all(checks);
  return findings;
}
