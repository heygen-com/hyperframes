/**
 * Server-side rendering for `<hyperframes-player>` via Declarative Shadow DOM.
 *
 * `renderPlayerShadowDomHtml` produces the inner HTML of a
 * `<template shadowrootmode="open">` that the browser parses into the
 * element's shadow root during HTML streaming — before any JavaScript runs.
 * The composition iframe therefore starts loading (and paints its first
 * frame) with zero client JS; when `@hyperframes/player` registers, the
 * element upgrade ADOPTS this DOM instead of rebuilding it, preserving the
 * already-loaded iframe.
 *
 * This module is DOM-free and safe to import in any server runtime.
 *
 * Contract with the client (guarded by declarative-shadow tests):
 * - the structure must match what `setupPlayerShadowDom` adopts
 *   (`div.hfp-container > iframe.hfp-iframe`, optional `img.hfp-poster`);
 * - the iframe src must equal `prepareSrc(...)` output so the upgrade replay
 *   of the `src` attribute recognizes it and skips the reload.
 */
import { prepareSrc, type ShaderLoadingMode } from "./shader-options.js";
import { PLAYER_STYLES } from "./styles.js";

export interface PlayerSsrOptions {
  /** URL to the composition HTML file (relative to the page). */
  src?: string;
  /** Poster image painted above the iframe until playback starts. */
  poster?: string;
  /** Composition width in pixels — aspect ratio only (default 1920). */
  width?: number;
  /** Composition height in pixels — aspect ratio only (default 1080). */
  height?: number;
  /** Mirror of the shader-capture-scale attribute, if the page sets it. */
  shaderCaptureScale?: number;
  /** Mirror of the shader-loading attribute, if the page sets it. */
  shaderLoading?: ShaderLoadingMode;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Pre-JS sizing: the client computes the fit scale in `scaleIframeToFit`
 * (inline styles, which override these rules after hydration). Server-side
 * the host box is unknown, so the fit is expressed in CSS — container-query
 * units divided by the composition size. Browsers without typed calc()
 * division drop the transform and the (clipped) frame still paints.
 */
function ssrSizingStyles(width: number, height: number): string {
  return [
    ".hfp-container { container-type: size; }",
    `.hfp-iframe[data-hfp-ssr] { width: ${width}px; height: ${height}px; ` +
      `transform: translate(-50%, -50%) ` +
      `scale(min(calc(100cqw / ${width}px), calc(100cqh / ${height}px))); }`,
  ].join("\n");
}

/**
 * Inner HTML for a `<template shadowrootmode="open">` child of
 * `<hyperframes-player>`. Framework-agnostic — string in, string out.
 */
/** Coerce interpolated dimensions defensively: they land inside a <style>
 *  block where a non-numeric value (from untyped JS callers) could otherwise
 *  break out of the stylesheet. */
function positiveDimension(value: number | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function renderPlayerShadowDomHtml(options: PlayerSsrOptions = {}): string {
  const width = positiveDimension(options.width, 1920);
  const height = positiveDimension(options.height, 1080);
  const preparedSrc = options.src
    ? prepareSrc(
        options.src,
        options.shaderCaptureScale !== undefined ? String(options.shaderCaptureScale) : null,
        options.shaderLoading ?? null,
      )
    : null;
  const srcAttribute = preparedSrc ? ` src="${escapeAttribute(preparedSrc)}"` : "";
  const poster = options.poster
    ? `<img class="hfp-poster" src="${escapeAttribute(options.poster)}">`
    : "";
  return (
    `<style data-hfp-ssr>${PLAYER_STYLES}\n${ssrSizingStyles(width, height)}</style>` +
    `<div class="hfp-container">` +
    `<iframe class="hfp-iframe" data-hfp-ssr ` +
    `sandbox="allow-scripts allow-same-origin" allow="autoplay; fullscreen" ` +
    `referrerpolicy="no-referrer" title="HyperFrames Composition"${srcAttribute}></iframe>` +
    `</div>` +
    poster
  );
}

/**
 * A complete server-renderable `<hyperframes-player>` tag with its declarative
 * shadow root, for non-React SSR (raw templates, Astro, etc.). React users get
 * the same markup from `<HyperframesPlayer ssr />`.
 */
export function renderPlayerTagHtml(
  options: PlayerSsrOptions & { className?: string; style?: string } = {},
): string {
  const attributes = [
    options.className ? ` class="${escapeAttribute(options.className)}"` : "",
    options.style ? ` style="${escapeAttribute(options.style)}"` : "",
    options.src ? ` src="${escapeAttribute(options.src)}"` : "",
    options.poster ? ` poster="${escapeAttribute(options.poster)}"` : "",
    options.width !== undefined ? ` width="${positiveDimension(options.width, 1920)}"` : "",
    options.height !== undefined ? ` height="${positiveDimension(options.height, 1080)}"` : "",
  ].join("");
  return (
    `<hyperframes-player${attributes}>` +
    `<template shadowrootmode="open">${renderPlayerShadowDomHtml(options)}</template>` +
    `</hyperframes-player>`
  );
}
