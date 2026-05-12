/**
 * HTML Compiler for Producer
 *
 * Two-phase compilation that guarantees every media element has data-end:
 * 1. Static pass via core's compileTimingAttrs() (data-start + data-duration → data-end)
 * 2. ffprobe resolution for elements without data-duration
 *
 * Also handles sub-compositions referenced via data-composition-src,
 * recursively extracting nested media from sub-sub-compositions.
 */
import { type ResolvedDuration, type UnresolvedElement } from "@hyperframes/core";
import { type VideoElement, type ImageElement, type AudioElement } from "@hyperframes/engine";
import type { Page } from "puppeteer-core";
export interface CompiledComposition {
    html: string;
    subCompositions: Map<string, string>;
    videos: VideoElement[];
    audios: AudioElement[];
    images: ImageElement[];
    unresolvedCompositions: UnresolvedElement[];
    /** Assets that resolve outside projectDir. Keys are the path used in HTML, values are absolute filesystem paths. */
    externalAssets: Map<string, string>;
    width: number;
    height: number;
    staticDuration: number;
    renderModeHints: RenderModeHints;
    hasShaderTransitions: boolean;
}
export type RenderModeHintCode = "iframe" | "requestAnimationFrame";
export interface RenderModeHint {
    code: RenderModeHintCode;
    message: string;
}
export interface RenderModeHints {
    recommendScreenshot: boolean;
    reasons: RenderModeHint[];
}
export declare function detectRenderModeHints(html: string): RenderModeHints;
export declare function detectShaderTransitionUsage(html: string): boolean;
/**
 * Download external CDN scripts and inline them into the HTML so rendering
 * works without network access (Docker, CI, restricted environments).
 */
export declare function inlineExternalScripts(html: string): Promise<string>;
/**
 * Scan compiled HTML for asset references that resolve outside projectDir.
 * For each, map the normalized in-HTML path to the real filesystem path so
 * the orchestrator can copy them into the compiled output directory.
 *
 * Handles: src/href attributes, CSS url(), inline style url().
 */
export declare function collectExternalAssets(html: string, projectDir: string): {
    html: string;
    externalAssets: Map<string, string>;
};
/**
 * Compile an HTML composition project into a single self-contained HTML string
 * with all media metadata resolved.
 */
export declare function compileForRender(projectDir: string, htmlPath: string, downloadDir: string): Promise<CompiledComposition>;
/**
 * Discover media elements from the browser DOM after JavaScript has run.
 * This catches videos/audios whose `src` is set dynamically via JS
 * (e.g. `document.getElementById("pip-video").src = URL`), which the
 * static regex parsers miss because the HTML has `src=""`.
 */
export interface BrowserMediaElement {
    id: string;
    tagName: "video" | "audio";
    src: string;
    start: number;
    end: number;
    duration: number;
    mediaStart: number;
    loop: boolean;
    hasAudio: boolean;
    volume: number;
}
export declare function discoverMediaFromBrowser(page: Page): Promise<BrowserMediaElement[]>;
/**
 * Resolve composition durations via Puppeteer by querying window.__timelines.
 * The page must already have the interceptor loaded and timelines registered.
 */
export declare function resolveCompositionDurations(page: Page, unresolved: UnresolvedElement[]): Promise<ResolvedDuration[]>;
/**
 * Re-compile after composition durations are resolved.
 * Injects durations into the HTML and re-parses sub-composition media with proper bounds.
 */
export declare function recompileWithResolutions(compiled: CompiledComposition, resolutions: ResolvedDuration[], projectDir: string, downloadDir: string): Promise<CompiledComposition>;
//# sourceMappingURL=htmlCompiler.d.ts.map