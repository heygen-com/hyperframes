/**
 * Family names that resolve to a host-OS font (or a CSS generic that the
 * browser substitutes with a host-OS font). Exported so plan-time validators
 * can reject them as primary families in distributed renders.
 *
 * Lower-cased — call `normalizeFamilyName` on declared values before lookup.
 */
export declare const GENERIC_FAMILIES: ReadonlySet<string>;
/**
 * Parse a single `font-family` value (e.g. `"Inter", -apple-system,
 * sans-serif`) into a list of unquoted family names in declaration order.
 * Whitespace and surrounding `"…"` / `'…'` quotes are stripped; case is
 * preserved. Pass each name through `normalizeFamilyName` for case-
 * insensitive comparisons.
 */
export declare function parseFontFamilyValue(value: string): string[];
/** Surfaces font-family is declared on in served HTML. */
export type FontFamilySurface = "font-family" | "data-font-family";
/**
 * Iterate every font-family declaration in a compiled HTML document. Yields
 * each declaration's surface (CSS property vs HTML attribute), raw value,
 * and the parsed family list. Used by both the @font-face injector and the
 * plan-time validator so they read the same surface area.
 */
export declare function iterateFontFamilyDeclarations(html: string): Generator<{
    surface: FontFamilySurface;
    declaration: string;
    families: string[];
}, void, void>;
/**
 * Typed code classifying a font-fetch failure as non-retryable for
 * distributed workflow adapters — a missing Google Fonts entry will not heal
 * on retry.
 */
export declare const FONT_FETCH_FAILED = "FONT_FETCH_FAILED";
/**
 * Typed error thrown by {@link injectDeterministicFontFaces} when
 * `failClosedFontFetch === true` and an external font fetch fails. The
 * default (swallow + warn) preserves the in-process behavior.
 */
export declare class FontFetchError extends Error {
    readonly code: typeof FONT_FETCH_FAILED;
    readonly familyName: string;
    readonly url: string;
    readonly cause?: unknown;
    constructor(familyName: string, url: string, message: string, cause?: unknown);
}
/**
 * Options for {@link injectDeterministicFontFaces}.
 */
export interface InjectDeterministicFontFacesOptions {
    /**
     * When `true`, any external font fetch failure (Google Fonts CSS or
     * woff2) throws {@link FontFetchError} with code `FONT_FETCH_FAILED`.
     *
     * Default `false`: failed fetches are silently swallowed; the composition
     * falls back to system fonts via `warnUnresolvedFonts`. This preserves the
     * in-process behavior.
     *
     * Distributed callers pass `true` so font availability is part of the
     * planDir's content-addressed hash and fetch failures surface as typed
     * non-retryable errors.
     */
    failClosedFontFetch?: boolean;
    /**
     * Injectable `fetch` implementation. Defaults to the global `fetch`.
     * Tests pass a stub to simulate fetch failures without going over the
     * network.
     */
    fetchImpl?: typeof fetch;
}
export declare function injectDeterministicFontFaces(html: string, options?: InjectDeterministicFontFacesOptions): Promise<string>;
//# sourceMappingURL=deterministicFonts.d.ts.map