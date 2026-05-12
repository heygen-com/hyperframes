/**
 * Path resolution utilities for the render pipeline.
 */
export interface RenderPaths {
    absoluteProjectDir: string;
    absoluteOutputPath: string;
}
type PathModuleLike = {
    resolve: (...segments: string[]) => string;
    relative: (from: string, to: string) => string;
    isAbsolute: (path: string) => boolean;
};
type IsPathInsideOptions = {
    pathModule?: PathModuleLike;
};
/**
 * Cross-platform containment check.
 *
 * `child.startsWith(parent + "/")` breaks on Windows because the path
 * separator is `\`, not `/`. This helper uses `path.relative()` which
 * normalises separators per-platform and returns `..`-prefixed output
 * for out-of-tree paths — the canonical way to ask "is `child` inside
 * `parent`?" on every supported OS.
 *
 * Both inputs are normalised via `resolve()` so callers don't need to.
 * Equality counts as "inside" (a directory contains itself).
 */
export declare function isPathInside(childPath: string, parentPath: string, options?: IsPathInsideOptions): boolean;
/**
 * Build a safe, cross-platform relative key for an absolute asset path
 * that lives outside the project directory.
 *
 * Windows absolute paths (`D:\coder\assets\segment.wav`) break two
 * downstream assumptions when passed as-is to `path.join(compileDir, key)`:
 *   1. The drive letter makes the path absolute, so `join()` silently
 *      discards `compileDir`.
 *   2. The backslashes and colon are invalid inside some OS sandboxes
 *      and HTTP URL encodings.
 *
 * We sanitise into `hf-ext/...` form using forward slashes, stripping
 * the colon after drive letters, the Windows extended-length prefix
 * (`\\?\`), and the UNC prefix (`\\server\share\`). The result is a
 * pure relative path that joins cleanly on every platform.
 *
 * Caller contract: `absPath` is expected to be canonical — typically
 * produced by `path.resolve()` upstream. This helper does NOT strip
 * `..` components on its own. `isPathInside` at copy time is the
 * defensive backstop.
 */
export declare function toExternalAssetKey(absPath: string): string;
export declare function resolveRenderPaths(projectDir: string, outputPath: string | null | undefined, rendersDir?: string): RenderPaths;
export {};
//# sourceMappingURL=paths.d.ts.map