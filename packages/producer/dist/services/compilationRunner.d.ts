/**
 * Compilation Test Runner
 *
 * Orchestrates compilation tests: compiles input HTML, compares to golden files.
 */
import { type CompilationValidationResult } from "./compilationTester.js";
export interface CompilationTestResult {
    testId: string;
    passed: boolean;
    validation: CompilationValidationResult;
    compilationTimeMs: number;
    compiledHtmlPath?: string;
}
interface TestSuite {
    id: string;
    dir: string;
    srcDir: string;
    goldenMp4: string;
    meta: Record<string, unknown>;
}
/**
 * Run compilation test for a test suite.
 * Compiles src/index.html and compares against compiled.html golden file.
 */
export declare function runCompilationTest(suite: TestSuite, keepTemp: boolean): Promise<CompilationTestResult>;
/**
 * Generate or update compiled.html golden file for a test suite.
 * Compiles src/index.html and writes to compiled.html.
 */
export declare function updateCompiledGolden(suite: TestSuite): Promise<void>;
export {};
//# sourceMappingURL=compilationRunner.d.ts.map