/**
 * Compilation Testing Service
 *
 * Validates that HTML compilation produces correct timing attributes.
 * Compares compiled HTML against golden files using semantic attribute matching.
 */
export interface CompiledElement {
    id: string;
    tagName: "video" | "audio" | "div";
    src?: string;
    dataStart: number;
    dataEnd: number | null;
    dataDuration: number | null;
    dataHasAudio?: boolean;
    dataMediaStart?: number;
    compositionSrc?: string;
}
export interface CompilationValidationResult {
    passed: boolean;
    actualElements: CompiledElement[];
    goldenElements: CompiledElement[];
    errors: string[];
    warnings: string[];
}
/**
 * Parse HTML and extract all elements with timing attributes.
 * Includes <video>, <audio>, and <div data-composition-src>.
 */
export declare function extractTimedElements(html: string): CompiledElement[];
/**
 * Validate compiled HTML against golden HTML.
 * Returns detailed validation result with errors and warnings.
 */
export declare function validateCompilation(actualHtml: string, goldenHtml: string): CompilationValidationResult;
//# sourceMappingURL=compilationTester.d.ts.map