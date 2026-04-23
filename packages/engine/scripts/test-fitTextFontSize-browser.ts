/**
 * Browser integration test for fitTextFontSize.
 *
 * Launches headless Chrome, loads the runtime IIFE into a page,
 * and verifies that window.__hyperframes.fitTextFontSize produces
 * correct results with real canvas measureText.
 *
 * Requires: puppeteer (dep of @hyperframes/engine)
 * Run: cd packages/engine && npx tsx scripts/test-fitTextFontSize-browser.ts
 */

import { buildHyperframesRuntimeScript } from "../../core/src/inline-scripts/hyperframesRuntime.engine";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function main() {
  // Dynamic import — puppeteer is a monorepo dep, not a core dep
  let puppeteer;
  try {
    puppeteer = (await import("puppeteer")).default;
  } catch {
    console.log(
      JSON.stringify({
        event: "fitTextFontSize_browser_test_skipped",
        reason: "puppeteer not available",
      }),
    );
    return;
  }

  const runtimeSource = buildHyperframesRuntimeScript({ minify: false });
  assert(
    runtimeSource !== null,
    "buildHyperframesRuntimeScript returned null — entry.ts not found",
  );

  const html = `<!DOCTYPE html>
<html><head>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@900&display=block');
</style>
</head><body>
<script>${runtimeSource}</script>
<script>
  window.__testResults = {};

  // Test 1: Short text should fit at base size
  var r1 = window.__hyperframes.fitTextFontSize("HI");
  window.__testResults.shortText = r1;

  // Test 2: Wide text should shrink below base size but still fit at 1600px
  var r2 = window.__hyperframes.fitTextFontSize(
    "CONGRATULATIONS TO EVERYBODY IN THE WORLD",
    { fontFamily: "sans-serif", fontWeight: 900, maxWidth: 1600 }
  );
  window.__testResults.wideText = r2;

  // Test 3: Extremely wide text that can't fit should return minFontSize
  var r3 = window.__hyperframes.fitTextFontSize(
    "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
    { fontFamily: "sans-serif", fontWeight: 900, maxWidth: 400 }
  );
  window.__testResults.extremeText = r3;

  // Test 4: Function exists and is callable
  window.__testResults.exists = typeof window.__hyperframes.fitTextFontSize === "function";
</script>
</body></html>`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 10000 });

    // Wait for font to potentially load (best effort — sans-serif fallback is fine for testing)
    await new Promise((r) => setTimeout(r, 1000));

    const results = await page.evaluate(() => (window as any).__testResults);

    // Test 1: Short text fits at base size (78px default)
    assert(results.exists === true, "fitTextFontSize should exist on window.__hyperframes");
    assert(
      results.shortText.fits === true,
      `Short text should fit, got fits=${results.shortText.fits}`,
    );
    assert(
      results.shortText.fontSize === 78,
      `Short text should use base size 78, got ${results.shortText.fontSize}`,
    );

    // Test 2: Wide text should shrink below base size
    assert(
      results.wideText.fits === true,
      `Wide text should still fit, got fits=${results.wideText.fits}`,
    );
    assert(
      results.wideText.fontSize < 78,
      `Wide text should shrink below 78, got ${results.wideText.fontSize}`,
    );

    // Test 3: Extreme text should hit floor
    assert(
      results.extremeText.fontSize === 42,
      `Extreme text should hit minFontSize 42, got ${results.extremeText.fontSize}`,
    );
    assert(
      results.extremeText.fits === false,
      `Extreme text should not fit, got fits=${results.extremeText.fits}`,
    );

    console.log(
      JSON.stringify({
        event: "fitTextFontSize_browser_test_passed",
        shortText: results.shortText,
        wideText: results.wideText,
        extremeText: results.extremeText,
      }),
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
