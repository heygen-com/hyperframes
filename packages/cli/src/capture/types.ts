/**
 * Types for the website capture pipeline.
 *
 * Phase 1: Capture — Extract HTML, CSS, screenshots, tokens, assets from a URL
 * Phase 2: Split — Decompose into per-section sub-compositions
 * Phase 3: Verify — Validate each section renders correctly
 * Phase 4: Scaffold — Assemble standard HyperFrames project
 */

// ── Phase 1: Capture ────────────────────────────────────────────────────────

export interface CaptureOptions {
  /** URL to capture */
  url: string;
  /** Output directory */
  outputDir: string;
  /** Viewport width (default: 1920) */
  viewportWidth?: number;
  /** Viewport height (default: 1080) */
  viewportHeight?: number;
  /** Page load timeout in ms (default: 120000) */
  timeout?: number;
  /** Extra wait after load for JS to settle (default: 3000) */
  settleTime?: number;
  /** Maximum screenshots to take (default: 24) */
  maxScreenshots?: number;
  /** Skip asset downloads */
  skipAssets?: boolean;
  /** Output JSON for programmatic use */
  json?: boolean;
}

export interface CaptureResult {
  /** Whether capture completed successfully */
  ok: boolean;
  /** Project output directory */
  projectDir: string;
  /** Source URL */
  url: string;
  /** Page title */
  title: string;
  /** Extracted HTML data */
  extracted: ExtractedHtml;
  /** Screenshot file paths (relative to projectDir) */
  screenshots: string[];
  /** Design tokens extracted from the page */
  tokens: DesignTokens;
  /** Downloaded asset paths (relative to projectDir) */
  assets: DownloadedAsset[];
  /** Animation catalog (captured during full-JS page load) */
  animationCatalog?: import("./animationCataloger.js").AnimationCatalog;
  /** Errors/warnings encountered during capture */
  warnings: string[];
}

export interface ExtractedHtml {
  /** All <style> tags from <head> (after stylesheet inlining) */
  headHtml: string;
  /** Full document.body.innerHTML */
  bodyHtml: string;
  /** CSS-in-JS rules from document.styleSheets (CSSOM) */
  cssomRules: string;
  /** <html> element attributes (class, data-theme, style, lang) */
  htmlAttrs: string;
  /** Original viewport width during capture */
  viewportWidth: number;
  /** Original viewport height during capture */
  viewportHeight: number;
  /** Full page scroll height */
  fullPageHeight: number;
}

// ── Design Tokens ───────────────────────────────────────────────────────────

export interface FontToken {
  family: string;
  weights: number[];
  variable?: boolean;
  weightRange?: [number, number];
}

export interface DesignTokens {
  /** Page title */
  title: string;
  /** Meta description */
  description: string;
  /** OG image URL */
  ogImage?: string;
  /** CSS custom properties from :root */
  cssVariables: Record<string, string>;
  /** Font families in use (with weights) */
  fonts: FontToken[];
  /** Extracted colors (background, text, accent) */
  colors: string[];
  /** Headings with text and basic styles */
  headings: Array<{
    level: number;
    text: string;
    fontSize: string;
    fontWeight: string;
    color: string;
  }>;
  /** CTA button/link text */
  ctas: Array<{ text: string; href?: string }>;
  /** SVG elements with labels (outerHTML kept in memory for asset downloader, stripped from saved JSON) */
  svgs: Array<{
    label?: string;
    viewBox?: string;
    width: number;
    height: number;
    outerHTML: string;
    isLogo: boolean;
  }>;
  /** Detected page sections with bounding rects */
  sections: Array<{
    selector: string;
    type: string;
    y: number;
    height: number;
    heading: string;
    backgroundColor?: string;
    backgroundImage?: string;
  }>;
}

// ── Design Styles (computed from live DOM) ──────────────────────────────────

export interface TypographyRole {
  role: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  color: string;
  sampleText: string;
}

export interface ComponentStyle {
  label: string;
  background: string;
  color: string;
  padding: string;
  borderRadius: string;
  border: string;
  boxShadow: string;
  fontSize: string;
  fontWeight: string;
  height: string;
}

export interface DesignStyles {
  typography: TypographyRole[];
  spacing: {
    observed: number[];
    baseUnit: number;
  };
  radius: string[];
  shadows: Array<{ value: string; count: number }>;
  buttons: ComponentStyle[];
  cards: ComponentStyle[];
  nav: ComponentStyle | null;
}

// ── Assets ──────────────────────────────────────────────────────────────────

export interface DownloadedAsset {
  /** Original URL */
  url: string;
  /** Local file path (relative to projectDir) */
  localPath: string;
  /** Asset type */
  type: "svg" | "image" | "favicon";
}
