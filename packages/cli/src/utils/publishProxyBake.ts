/**
 * Publish-time proxy baking (U6 of
 * docs/plans/2026-07-14-002-feat-transparent-media-proxies-plan.md).
 *
 * Published pages are static (no server), so the on-demand `?hf-proxy=`
 * negotiation the preview/play surfaces use (U3/U4) isn't possible there.
 * Instead this scans the archive's HTML entries for local `<video src>`
 * references to browser-hostile codecs (HEVC, ProRes, ...), transcodes each
 * one via the shared studio-server proxy transcoder, adds the proxy bytes to
 * the archive under a `_proxy/` prefix, and rewrites ONLY the matching
 * `<video src>` attributes in the archive's HTML copies to point at the
 * proxy.
 *
 * `<audio>` elements are never rewritten: verified (per the plan's Key
 * Technical Decisions) that AAC demuxes fine from an HEVC container in an
 * HEVC-less browser, so an `<audio>` sharing a hostile video's src plays the
 * original untouched. On-disk project files are never modified — only the
 * in-memory archive file map passed in by `publish.ts` (built via
 * `buildPublishFileMap`, baked here, then zipped via `zipPublishFileMap`).
 * `cloud render` never calls this: it uses `createPublishArchive` directly,
 * which has no baking hook (R2 in the plan).
 *
 * Alpha-bearing sources bake as VP9/WebM so transparency survives. A failed
 * hostile transcode aborts publish with a
 * structured manifest rather than silently shipping an unplayable asset.
 */

import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { parseHTML } from "linkedom";
import { rewriteAssetPath } from "@hyperframes/parsers/asset-paths";
import {
  cleanAssetUrl,
  isRemoteOrInlineUrl,
  resolveLocalAssetCandidates,
} from "@hyperframes/parsers/asset-resolution";
import {
  proxyVariantFor,
  scanProjectMediaCodecMap,
  type HtmlSourceLike,
} from "@hyperframes/studio-server/media-codec-map";
import {
  ProxyTranscodeError,
  resolveProxy,
  waitForProxy,
  TRANSCODE_TIMEOUT_MS,
} from "@hyperframes/studio-server/proxy-transcoder";
import { rewriteHtmlAttributes } from "./publishProject.js";

/** Archive-path prefix for baked proxy files, mirroring `localizeExternalAssets`'s `_ext/`. */
export const PROXY_ARCHIVE_PREFIX = "_proxy";

export interface ProxyBakeManifest {
  proxied: string[];
  /** @deprecated Alpha sources are proxied as VP9; retained as an always-empty compatibility field. */
  skippedAlpha: string[];
  failed: Array<{ path: string; error: string }>;
}

class ProxyBakeError extends Error {
  readonly manifest: ProxyBakeManifest;

  constructor(manifest: ProxyBakeManifest) {
    const summary = manifest.failed.map((entry) => `${entry.path}: ${entry.error}`).join("; ");
    super(`Unable to bake required browser media proxies (${summary})`);
    this.name = "ProxyBakeError";
    this.manifest = manifest;
  }
}

function emptyManifest(): ProxyBakeManifest {
  return { proxied: [], skippedAlpha: [], failed: [] };
}

function isHtmlEntry(path: string): boolean {
  return path.endsWith(".html") || path.endsWith(".htm");
}

/**
 * Mutates `fileContents` in place: adds a variant-specific `_proxy/<hash>` entry for every
 * browser-hostile local video asset referenced from the archive's HTML, and
 * rewrites those HTML entries' matching `<video src>` attributes to point at
 * the proxy. Returns a structured manifest; throws ProxyBakeError when any
 * required proxy cannot be prepared.
 */
export async function bakeMediaProxies(
  projectDir: string,
  fileContents: Map<string, Buffer>,
): Promise<ProxyBakeManifest> {
  const manifest = emptyManifest();
  const absProjectDir = resolve(projectDir);
  const htmlEntries = [...fileContents.entries()].filter(([path]) => isHtmlEntry(path));
  if (htmlEntries.length === 0) return manifest;

  const htmlSources: HtmlSourceLike[] = htmlEntries.map(([entryPath, content]) => ({
    html: content.toString("utf-8"),
    compSrcPath: entryPath,
  }));

  const codecMap = await scanProjectMediaCodecMap(absProjectDir, htmlSources);
  const hostileEntries = Object.entries(codecMap).filter(([, facts]) => facts.browserHostile);
  if (hostileEntries.length === 0) return manifest;

  // Absolute source path -> archive path of its baked proxy. Built by
  // resolving each map key back to an absolute path the same way
  // `compositionServer.ts`'s `injectMediaCodecMap` does, since the map is
  // keyed by project-root-relative URL pathname (per the plan's KTD), not a
  // filesystem path.
  const proxyByAbsolutePath = new Map<string, string>();

  await Promise.all(
    hostileEntries.map(async ([pathname, facts]) => {
      const absoluteSourcePath = resolve(absProjectDir, pathname.replace(/^\/+/, ""));
      try {
        const proxyPath = await waitForProxy(
          resolveProxy(absProjectDir, absoluteSourcePath, proxyVariantFor(facts)),
          TRANSCODE_TIMEOUT_MS,
        );
        const archivePath = `${PROXY_ARCHIVE_PREFIX}/${basename(proxyPath)}`;
        fileContents.set(archivePath, await readFile(proxyPath));
        proxyByAbsolutePath.set(absoluteSourcePath, archivePath);
        manifest.proxied.push(pathname);
      } catch (err) {
        const reason = err instanceof ProxyTranscodeError ? err.message : String(err);
        manifest.failed.push({ path: pathname, error: reason });
      }
    }),
  );

  manifest.proxied.sort();
  manifest.skippedAlpha.sort();
  manifest.failed.sort((a, b) => a.path.localeCompare(b.path));
  if (manifest.failed.length > 0) throw new ProxyBakeError(manifest);
  if (proxyByAbsolutePath.size === 0) return manifest;

  for (const [entryPath, content] of htmlEntries) {
    const { document } = parseHTML(content.toString("utf-8"));
    const referrerAbsDir = resolve(absProjectDir, dirname(entryPath));
    const modified = rewriteHtmlAttributes(
      document,
      referrerAbsDir,
      entryPath,
      (rawValue) => {
        const cleaned = cleanAssetUrl(rawValue);
        if (!cleaned || isRemoteOrInlineUrl(cleaned)) return null;
        // Resolve the raw attribute value the same way the scan did
        // (rewriteAssetPath to root-relative, then decodeUrlPathVariants via
        // resolveLocalAssetCandidates) so percent-encoded and root-absolute
        // srcs match the map keys the scan produced.
        const rootRelativeSrc = rewriteAssetPath(entryPath, cleaned);
        for (const candidate of resolveLocalAssetCandidates(absProjectDir, rootRelativeSrc)) {
          const archivePath = proxyByAbsolutePath.get(candidate);
          if (archivePath) return archivePath;
        }
        return null;
      },
      { selector: "video[src]", attrs: ["src"] },
    );
    if (modified) fileContents.set(entryPath, Buffer.from(document.toString(), "utf-8"));
  }
  return manifest;
}
