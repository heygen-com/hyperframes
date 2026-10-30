import { findStartTags, insertBeforeCloseTag } from "@hyperframes/core/compiler/html-document";

const URL_BASE = "http://localhost/";

function urlPath(src: string): string | null {
  return URL.canParse(src, URL_BASE) ? new URL(src, URL_BASE).pathname : null;
}

export function isGsapCoreUrl(src: string): boolean {
  return /\/gsap(-\d+(\.\d+)*)?(\.min)?\.js$/i.test(urlPath(src) ?? "");
}

const GSAP_PLUGIN_FILE =
  /\/(\w+Plugin|CustomBounce|CustomEase|CustomWiggle|Draggable|EasePack|Flip|GSDevTools|MotionPathHelper|Observer|ScrollSmoother|ScrollTrigger|SplitText)(\.min)?\.js$/i;

function isGsapPluginUrl(src: string): boolean {
  const path = urlPath(src);
  if (!path || isGsapCoreUrl(src)) return false;
  return GSAP_PLUGIN_FILE.test(path) || /\/gsap(@[^/]*)?\/(.+\/)?[^/]+\.js$/i.test(path);
}

const TEMPLATE_ELEMENT = /<template\b[^>]*>[\s\S]*?<\/template>/gi;
const SCRIPT_SRC = /<script\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const INLINED_MARKER = /\/\*\s*inlined:\s*(\S+)\s*\*\//gi;
const CORE_LICENSE_BANNER = /\/\*!\s*\*\s*GSAP\s+\d/;
const PLUGIN_LICENSE_BANNER = /\/\*!\s*\*\s*(?!GSAP\s)\w+\s+\d[^*]*\*\s*https:\/\/gsap\.com/;
const CORE_BODY = /Missing plugin\? gsap\.registerPlugin\(\)/;

function scriptUrls(html: string): string[] {
  const srcs = [...html.matchAll(SCRIPT_SRC)].map((m) =>
    (m[1] ?? m[2] ?? m[3] ?? "").replace(/&amp;/gi, "&"),
  );
  return [...srcs, ...[...html.matchAll(INLINED_MARKER)].map((m) => m[1] ?? "")];
}

// Only a loaded core script counts: authored usage such as gsap.registerPlugin() proves nothing.
export function htmlHasGsapCore(html: string): boolean {
  const live = html.replace(TEMPLATE_ELEMENT, "");
  return (
    scriptUrls(live).some(isGsapCoreUrl) || CORE_LICENSE_BANNER.test(live) || CORE_BODY.test(live)
  );
}

function isGsapPluginScript(script: string): boolean {
  return scriptUrls(script).some(isGsapPluginUrl) || PLUGIN_LICENSE_BANNER.test(script);
}

/** Puts `coreTag` ahead of the first GSAP plugin script in the head; null when the head has none. */
export function insertGsapCoreBeforeHeadPlugin(html: string, coreTag: string): string | null {
  const lowered = html.toLowerCase();
  const at = findStartTags(html, "script").find((start) => {
    const close = lowered.indexOf("</script", start);
    return isGsapPluginScript(html.slice(start, close === -1 ? undefined : close));
  });
  if (at === undefined || insertBeforeCloseTag(html.slice(0, at), "head", "") !== null) return null;
  return `${html.slice(0, at)}${coreTag}\n${html.slice(at)}`;
}
