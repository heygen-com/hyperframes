import { existsSync } from "node:fs";
import { isAbsolute, posix, relative, resolve } from "node:path";
import { decodeUrlPathVariants } from "@hyperframes/parsers/composition";

/**
 * Shared local-asset resolution helpers used by both the project-level lint
 * rules (`project.ts`) and the HEVC preview-codec check
 * (`hevcPreviewLint.ts`). Split out so the latter doesn't need to import from
 * `project.ts` (which imports it back to run the rule) — that would be a
 * circular import within the package.
 */

export function isRemoteOrInlineUrl(url: string): boolean {
  return /^(https?:|data:|blob:|\/\/|#)/i.test(url);
}

export function cleanAssetUrl(url: string): string {
  return url.trim().split(/[?#]/, 1)[0] ?? "";
}

export function isWithinProjectRoot(projectDir: string, candidate: string): boolean {
  const projectRoot = resolve(projectDir);
  const relativePath = relative(projectRoot, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function addCandidate(candidates: string[], candidate: string): void {
  if (!candidates.includes(candidate)) candidates.push(candidate);
}

export function resolveLocalAssetCandidates(projectDir: string, url: string): string[] {
  const cleanUrl = cleanAssetUrl(url);
  const projectRoot = resolve(projectDir);
  const candidates: string[] = [];

  for (const variant of decodeUrlPathVariants(cleanUrl)) {
    const projectRelative = variant.startsWith("/") ? variant.slice(1) : variant;
    const resolved = resolve(projectRoot, projectRelative);
    if (isWithinProjectRoot(projectRoot, resolved)) {
      addCandidate(candidates, resolved);
      continue;
    }

    const normalized = posix.normalize(projectRelative.replace(/\\/g, "/"));
    const clamped = normalized.replace(/^(\.\.\/)+/, "");
    if (clamped && !clamped.startsWith("..")) {
      addCandidate(candidates, resolve(projectRoot, clamped));
    }
  }

  return candidates;
}

export function resolveExistingLocalAsset(
  projectDir: string,
  url: string,
): { resolved: string; rootRelativePath: string } | null {
  const projectRoot = resolve(projectDir);
  const resolved = resolveLocalAssetCandidates(projectRoot, url).find(existsSync);
  if (!resolved) return null;
  return { resolved, rootRelativePath: relative(projectRoot, resolved) };
}

function maskRange(src: string, pattern: RegExp): string {
  return src.replace(pattern, (m) => " ".repeat(m.length));
}

/** Blanks out comments, `<style>`, and `<script>` bodies so tag-scanning
 * regexes don't false-positive on commented-out or scripted markup. */
export function maskNonScannableRanges(html: string): string {
  let out = maskRange(html, /<!--[\s\S]*?-->/g);
  out = maskRange(out, /<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi);
  out = maskRange(out, /<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi);
  return out;
}
