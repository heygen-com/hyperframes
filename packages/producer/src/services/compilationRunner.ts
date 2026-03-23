/**
 * Compilation Test Runner
 *
 * Orchestrates compilation tests: compiles input HTML, compares to golden files.
 */

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileForRender } from "./htmlCompiler.js";
import { validateCompilation, type CompilationValidationResult } from "./compilationTester.js";

export interface CompilationTestResult {
  testId: string;
  passed: boolean;
  validation: CompilationValidationResult;
  compilationTimeMs: number;
  compiledHtmlPath?: string; // For --keep-temp
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
export async function runCompilationTest(
  suite: TestSuite,
  keepTemp: boolean,
): Promise<CompilationTestResult> {
  const startTime = Date.now();

  // Create temp directory for downloads (if HTML has HTTP URLs)
  const tempDir = mkdtempSync(join(tmpdir(), `compile-test-${suite.id}-`));

  try {
    // Compile the input HTML
    const inputHtmlPath = join(suite.srcDir, "index.html");
    if (!existsSync(inputHtmlPath)) {
      throw new Error(`Input HTML not found: ${inputHtmlPath}`);
    }

    const compiled = await compileForRender(suite.srcDir, inputHtmlPath, tempDir);

    const actualHtml = compiled.html;

    // Load golden compiled HTML
    const goldenPath = join(suite.dir, "output", "compiled.html");
    if (!existsSync(goldenPath)) {
      throw new Error(`Golden compiled.html not found: ${goldenPath}`);
    }

    const goldenHtml = readFileSync(goldenPath, "utf-8");

    // Validate
    const validation = validateCompilation(actualHtml, goldenHtml);

    const compilationTimeMs = Date.now() - startTime;

    // Save compiled HTML if --keep-temp
    let compiledHtmlPath: string | undefined;
    if (keepTemp) {
      compiledHtmlPath = join(tempDir, "compiled.html");
      writeFileSync(compiledHtmlPath, actualHtml, "utf-8");
    }

    return {
      testId: suite.id,
      passed: validation.passed,
      validation,
      compilationTimeMs,
      compiledHtmlPath,
    };
  } catch (error) {
    const compilationTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      testId: suite.id,
      passed: false,
      validation: {
        passed: false,
        actualElements: [],
        goldenElements: [],
        errors: [`Compilation failed: ${errorMessage}`],
        warnings: [],
      },
      compilationTimeMs,
    };
  } finally {
    // Cleanup temp directory unless --keep-temp
    if (!keepTemp && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * Generate or update compiled.html golden file for a test suite.
 * Compiles src/index.html and writes to compiled.html.
 */
export async function updateCompiledGolden(suite: TestSuite): Promise<void> {
  console.log(`[${suite.id}] Updating compiled.html golden file...`);

  // Create temp directory for downloads
  const tempDir = mkdtempSync(join(tmpdir(), `update-golden-${suite.id}-`));

  try {
    const inputHtmlPath = join(suite.srcDir, "index.html");
    if (!existsSync(inputHtmlPath)) {
      throw new Error(`Input HTML not found: ${inputHtmlPath}`);
    }

    // Compile the input HTML
    const compiled = await compileForRender(suite.srcDir, inputHtmlPath, tempDir);

    // Write to output/compiled.html
    const outputDir = join(suite.dir, "output");
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }
    const goldenPath = join(outputDir, "compiled.html");
    writeFileSync(goldenPath, compiled.html, "utf-8");

    console.log(
      `[${suite.id}] ✓ Updated output/compiled.html (${compiled.videos.length} video(s), ${compiled.audios.length} audio(s))`,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${suite.id}] ✗ Failed to update compiled.html: ${errorMessage}`);
    throw error;
  } finally {
    // Cleanup temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
