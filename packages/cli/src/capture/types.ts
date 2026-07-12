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
  /** Extracted colors (background, text, accent), ranked by weighted usage */
  colors: string[];
  /**
   * Per-color usage signals for brand classification (how each color is used:
   * as a fill, on interactive elements, on large areas, or as text). Consumers
   * (e.g. design-system build) use these to pick the brand primary — the
   * chromatic color most used as an interactive/repeated FILL, as distinct from
   * section surfaces (large blocks) and link/text colors. Top ~48 by usage.
   */
  colorStats?: Array<{
    hex: string;
    /** total occurrences across bg + text */
    count: number;
    /** times used as a non-transparent background */
    bgCount: number;
    /** times that background sat on an interactive element (a/button/role) */
    interactiveBg: number;
    /** times that background covered a large area (> 50000px²) */
    areaBg: number;
    /** times used as a text color */
    textCount: number;
    /** largest single area (px²) this color filled */
    maxArea: number;
  }>;
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
  /** Detected page sections with bounding rects + inner content for recreation */
  sections: Array<{
    selector: string;
    type: string;
    x?: number;
    y: number;
    width?: number;
    height: number;
    heading: string;
    backgroundColor?: string;
    backgroundImage?: string;
    /** Visible button/link labels inside the section */
    callsToAction?: string[];
    /** Squeezed body text (≤600 chars) */
    text?: string;
    /** Coarse layout hint for rebuild */
    layout?: "stacked" | "grid" | "split" | "centered";
    /** In-section media URLs (remote at extraction; joined to local in index.ts) */
    assetUrls?: string[];
    /** Local asset paths (assets/…) resolved from assetUrls after download */
    assets?: string[];
  }>;
  /** Full-page + viewport geometry (drives measured scroll distance downstream) */
  page?: {
    width: number;
    height: number;
    viewport: { width: number; height: number };
  };
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
  /** Gradient background-image if any (url()/none dropped) — a core brand signal */
  backgroundImage?: string;
  /** backdrop-filter value if any (frosted-glass panels); "" when none */
  backdropFilter?: string;
  color: string;
  padding: string;
  borderRadius: string;
  border: string;
  boxShadow: string;
  fontSize: string;
  fontWeight: string;
  height: string;
}

export interface StatCellStyle {
  background: string;
  borderRadius: string;
  border: string;
  boxShadow: string;
  /** the large numeral's type */
  numberFontSize: string;
  numberFontWeight: string;
  numberColor: string;
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
  /** pill / badge / chip / tag — small rounded labelled elements */
  chips?: ComponentStyle[];
  /** metric / KPI cells (a large numeral + label) */
  statCells?: StatCellStyle[];
  /** tab controls */
  tabs?: ComponentStyle[];
  /** Dominant gradient/mesh background washes, ranked by on-screen area covered */
  backgrounds?: Array<{ value: string; area: number }>;
  /** Frosted-glass panels (backdrop-filter): raw translucent fill + blur, ranked by area */
  glass?: Array<{
    backdropFilter: string;
    background: string;
    border: string;
    borderRadius: string;
    boxShadow: string;
    area: number;
  }>;
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
