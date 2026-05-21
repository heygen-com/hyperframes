import { writeFileSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import type { ExplainerVideoBrief } from "./types.js";

const COVER_FILENAME_BASE = "cover";
const QR_DEFAULT_SIZE_PX = 320;

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

function inferExtension(contentType: string | null, url: string): string {
  if (contentType) {
    const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (EXT_BY_MIME[base]) return EXT_BY_MIME[base];
  }
  const match = url.match(/\.(png|jpe?g|webp|gif|avif)(?:\?|$)/i);
  if (match && match[1]) return match[1].toLowerCase().replace("jpeg", "jpg");
  return "png";
}

/**
 * Fetch the cover image into projectDir and return the relative path the LLM
 * should use in the composition. Returns null on any failure — caller falls
 * back to the original remote URL (which will likely fail in Chromium due to
 * Substack CDN missing CORS headers, but no worse than today).
 */
export async function prefetchCoverImage(
  brief: ExplainerVideoBrief,
  projectDir: string,
): Promise<string | null> {
  const url = brief.article.coverImage?.trim();
  if (!url) return null;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "amplifier-video-worker/1.0" },
    });
    if (!response.ok) {
      console.warn(`[post-process] cover image fetch failed (${response.status}) ${url}`);
      return null;
    }
    const ext = inferExtension(response.headers.get("content-type"), url);
    const filename = `${COVER_FILENAME_BASE}.${ext}`;
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(join(projectDir, filename), buffer);
    return `./${filename}`;
  } catch (err) {
    console.warn(`[post-process] cover image fetch error ${url}`, err);
    return null;
  }
}

/**
 * Return a derived brief whose article.coverImage points at the local file.
 * Original brief is not mutated.
 */
export function briefWithLocalCover(
  brief: ExplainerVideoBrief,
  localPath: string,
): ExplainerVideoBrief {
  return {
    ...brief,
    article: { ...brief.article, coverImage: localPath },
  };
}

const CROSSORIGIN_ON_LOCAL_IMG =
  /(<img[^>]*\bsrc\s*=\s*["']\.\/[^"']+["'][^>]*?)\s+crossorigin\s*=\s*["'][^"']*["']/gi;

/**
 * Strip crossorigin="..." from <img> tags whose src is a relative local path.
 * Chromium occasionally rejects local-file images when crossorigin is set on a
 * file:// load; stripping it removes that risk and is a no-op when the LLM
 * didn't add the attribute.
 */
export function stripCrossoriginOnLocalImages(html: string): string {
  return html.replace(CROSSORIGIN_ON_LOCAL_IMG, "$1");
}

export interface QrInjectionResult {
  html: string;
  injected: boolean;
  fallbackAppended: boolean;
}

const QR_MOUNT_PATTERN =
  /(<div[^>]*\bclass\s*=\s*["'][^"']*\bqr-mount\b[^"']*["'][^>]*>)([\s\S]*?)(<\/div>)/i;
const CLOSE_SCENE_PATTERN =
  /(<section[^>]*\bid\s*=\s*["']scene-(?:close|cta|outro|end|finale)["'][^>]*>)([\s\S]*?)(<\/section>)/i;

async function renderQrSvg(url: string, size: number): Promise<string> {
  const svg = await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: size,
    color: { dark: "#181511", light: "#0000" },
  });
  return svg.replace(/<\?xml[^?]*\?>\s*/i, "");
}

/**
 * Generate a QR code for ctaUrl and inject it into the composition.
 *
 * Strategy:
 *   1. Find an element with class="qr-mount" (the convention the LLM is
 *      instructed to include) and replace its contents with the QR SVG.
 *   2. If no mount is present, append a QR card to the close scene so the
 *      addition is non-destructive even if the LLM forgot the mount.
 *   3. If neither a mount nor a close scene exists, leave the html alone.
 */
export async function injectQrCode(
  html: string,
  ctaUrl: string | null | undefined,
  size: number = QR_DEFAULT_SIZE_PX,
): Promise<QrInjectionResult> {
  const url = ctaUrl?.trim();
  if (!url) return { html, injected: false, fallbackAppended: false };

  let svg: string;
  try {
    svg = await renderQrSvg(url, size);
  } catch (err) {
    console.warn("[post-process] qr-code generation failed", err);
    return { html, injected: false, fallbackAppended: false };
  }

  if (QR_MOUNT_PATTERN.test(html)) {
    const next = html.replace(QR_MOUNT_PATTERN, `$1${svg}$3`);
    return { html: next, injected: true, fallbackAppended: false };
  }

  if (CLOSE_SCENE_PATTERN.test(html)) {
    const fallbackCard = `<div class="qr-mount" data-qr-injected="fallback" style="position:absolute;right:48px;bottom:48px;width:${size}px;height:${size}px;background:#fff;padding:12px;box-shadow:0 12px 40px rgba(0,0,0,.35);z-index:25;">${svg}</div>`;
    const next = html.replace(CLOSE_SCENE_PATTERN, `$1$2${fallbackCard}$3`);
    return { html: next, injected: true, fallbackAppended: true };
  }

  return { html, injected: false, fallbackAppended: false };
}
