import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEBUG_DIR = resolve(__dirname, ".debug");
const FIXTURE_DIR = resolve(__dirname, "fixtures/parity-project");
const PROJECT_ID = "parity-project";
// Diff is computed at 480×270 (1/4 linear scale) to average out H.264 quantization and sub-pixel
// font-rendering noise. At that scale ~1.2% of 255 leaves comfortable room for the codec's inherent
// limited-range chroma rounding while still catching macro-level position / color / opacity errors.
const MAX_YAVG = 3.0;

function ensureDebugDir(): void {
  mkdirSync(DEBUG_DIR, { recursive: true });
}

// Pristine source HTML — restored before each run so style edits from previous
// runs (which are patched directly into index.html) don't silently no-op.
const PRISTINE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Parity Project</title>
    <script>
      window.__timelines = window.__timelines || {};
    </script>
    <script data-hyperframes-preview-runtime="1" src=""></script>
    <style>
      html,
      body {
        margin: 0;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: #1a1a2e;
      }

      #root {
        width: 1920px;
        height: 1080px;
        position: relative;
        overflow: hidden;
      }

      #title {
        position: absolute;
        top: 200px;
        left: 200px;
        margin: 0;
        font-family: sans-serif;
        font-size: 80px;
        font-weight: 700;
        color: #ffffff;
        line-height: 1.2;
        white-space: nowrap;
      }

      #photo {
        position: absolute;
        top: 100px;
        right: 200px;
        width: 400px;
        height: 300px;
        background: #3b82f6;
      }

      #clip {
        position: absolute;
        bottom: 100px;
        left: 200px;
        width: 600px;
        height: 338px;
        background: #5e81ac;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="parity-main"
      data-width="1920"
      data-height="1080"
      data-duration="3"
      data-fps="30"
      data-start="0"
    >
      <p id="title" class="clip" data-start="0" data-duration="3">Hello Parity</p>
      <div id="photo" class="clip" data-start="0" data-duration="3"></div>
      <div id="clip" class="clip" data-start="0" data-duration="3"></div>
    </div>
  </body>
</html>
`;

function resetFixture(): void {
  // Remove Studio runtime artifacts so the test always starts from a clean state.
  rmSync(resolve(FIXTURE_DIR, ".hyperframes"), { recursive: true, force: true });
  // Restore index.html to its pristine state. Style commits (color changes, etc.)
  // patch the source HTML directly — not just .hyperframes/ — so without this
  // the color patch becomes a no-op on the second run (same value → ETag stays).
  writeFileSync(resolve(FIXTURE_DIR, "index.html"), PRISTINE_INDEX_HTML, "utf-8");
}

async function fetchETag(page: Page): Promise<string> {
  const res = await page.request.head(`/api/projects/${PROJECT_ID}/preview`);
  return res.headers()["etag"] ?? "";
}

async function waitForETagChange(page: Page, initial: string): Promise<void> {
  await expect(async () => {
    expect(await fetchETag(page)).not.toBe(initial);
  }).toPass({ timeout: 10_000, intervals: [200] });
}

test("preview matches render after UI edits", async ({ page, context }) => {
  ensureDebugDir();
  resetFixture();

  // ── 1. Load studio and wait for the composition canvas ───────────────────
  await page.goto("http://localhost:4200");
  // The canvas overlay appears once the editor has loaded the project
  const canvas = page.locator('[aria-label="Composition canvas"]');
  await canvas.waitFor({ state: "visible", timeout: 30_000 });

  // ── 2. Select #title via Layers panel and shift X by 120px ───────────────
  // Inspector button opens the right panel on the Design tab
  await page.locator('[aria-label="Inspector"]').click();
  // Switch to Layers tab so we can select by element
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  // Click the "Title" layer item — stays on Layers tab per Studio behaviour
  // Layer buttons include a tag badge ("P") so accessible name is "P Title", not "Title"
  await page
    .getByRole("button", { name: /\bTitle\b/ })
    .first()
    .click();
  // Now switch to Design tab to access Layout / color controls
  await page.getByRole("button", { name: "Design", exact: true }).click();
  // Wait until the Layout section (which contains the X field) is visible
  const layoutSection = page
    .locator("section")
    .filter({ has: page.locator("h3", { hasText: "Layout" }) });
  await layoutSection.waitFor({ state: "visible", timeout: 5_000 });
  // The first text input in the Layout section is X (manual offset)
  const xInput = layoutSection.locator("input[type=text]").first();
  const etag0 = await fetchETag(page);
  await xInput.fill("120");
  await xInput.press("Enter");
  await waitForETagChange(page, etag0);

  // ── 3. Change #title text color to #00bcd4 ────────────────────────────────
  const etag1 = await fetchETag(page);
  await page.locator('[aria-label="Pick text color color"]').click();
  const hexInput = page.locator("label").filter({ hasText: /^Hex$/ }).locator("input");
  await hexInput.waitFor({ state: "visible" });
  await hexInput.fill("00BCD4");
  await hexInput.press("Tab");
  await page.keyboard.press("Escape");
  await waitForETagChange(page, etag1);

  // ── 4. Change #clip opacity to 80% ───────────────────────────────────────
  const etag2 = await fetchETag(page);
  // Switch to Layers tab to select #clip
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  // Same badge prefix issue: accessible name is "Vi Clip" not "Clip"
  await page
    .getByRole("button", { name: /\bClip\b/ })
    .first()
    .click();
  // Switch to Design tab to access the Transparency section
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.getByText("Transparency", { exact: true }).click();
  // Scope the slider to the Transparency section to avoid matching the timeline seek slider.
  // fill() properly triggers React's onChange on the controlled range input.
  const transparencySection = page
    .locator("section")
    .filter({ has: page.locator("h3", { hasText: "Transparency" }) });
  const opacitySlider = transparencySection.locator("input[type=range]");
  await opacitySlider.waitFor({ state: "visible" });
  await opacitySlider.fill("80");
  await waitForETagChange(page, etag2);

  // ── 4.5. Reload studio — verify edits survive a page refresh ─────────────
  // Catches the class of bug where bootstrap re-applies an empty in-memory
  // manifest to the preview or clobbers source files on load, reversing edits
  // that were correctly persisted to disk (studio-manual-edits.json / index.html).
  const etagAfterEdits = await fetchETag(page);
  await page.reload();
  await canvas.waitFor({ state: "visible", timeout: 30_000 });
  expect(await fetchETag(page)).toBe(etagAfterEdits);

  // ── 5. Screenshot preview at t=0, t=1, t=2 ───────────────────────────────
  const previewPage = await context.newPage();
  await previewPage.setViewportSize({ width: 1920, height: 1080 });
  await previewPage.goto(`http://localhost:4200/api/projects/${PROJECT_ID}/preview`);
  await previewPage.waitForLoadState("networkidle");
  await previewPage.waitForFunction(
    () => typeof (window as Record<string, unknown>).__player === "object",
    { timeout: 15_000 },
  );

  for (const t of [0, 1, 2]) {
    await previewPage.evaluate(
      (time: number) => (window as Record<string, unknown>).__player?.seek?.(time),
      t,
    );
    await previewPage.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    await previewPage.waitForTimeout(50);
    await previewPage.screenshot({
      path: resolve(DEBUG_DIR, `preview_t${t}.png`),
      clip: { x: 0, y: 0, width: 1920, height: 1080 },
    });
  }
  await previewPage.close();

  // ── 6. Trigger render via API, wait for completion via SSE ───────────────
  const renderRes = await page.request.post(`/api/projects/${PROJECT_ID}/render`, {
    data: { fps: 30, quality: "draft", format: "mp4" },
  });
  expect(renderRes.ok()).toBeTruthy();
  const { jobId } = (await renderRes.json()) as { jobId: string };

  await page.evaluate(
    (id: string) =>
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          es.close();
          reject(new Error("Render timed out after 120s"));
        }, 120_000);
        const es = new EventSource(`/api/render/${id}/progress`);
        es.addEventListener("progress", (ev) => {
          const d = JSON.parse((ev as MessageEvent).data) as {
            status: string;
            error?: string;
          };
          if (d.status === "complete") {
            clearTimeout(timeout);
            es.close();
            resolve();
          } else if (d.status === "failed") {
            clearTimeout(timeout);
            es.close();
            reject(new Error(`Render failed: ${d.error}`));
          }
        });
      }),
    jobId,
  );

  // ── 7. Download rendered video and extract frames with ffmpeg ─────────────
  const dlRes = await page.request.get(`/api/render/${jobId}/download`);
  expect(dlRes.ok()).toBeTruthy();
  const renderVideoPath = resolve(DEBUG_DIR, "render.mp4");
  writeFileSync(renderVideoPath, Buffer.from(await dlRes.body()));

  for (const t of [0, 1, 2]) {
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      renderVideoPath,
      // scale=in_range=tv:out_range=pc: expand limited-range H.264 to full-range so PNG
      // values match Playwright screenshots (Ubuntu ffmpeg 6.1.1 doesn't auto-expand).
      "-vf",
      `select=eq(n\\,${t * 30}),scale=in_range=tv:out_range=pc`,
      "-vframes",
      "1",
      resolve(DEBUG_DIR, `render_t${t}.png`),
    ]);
  }

  // ── 8. Diff preview vs render frames; fail if avg luma diff > threshold ───
  const failures: string[] = [];
  const yavgScores: Record<string, number> = {};

  for (const t of [0, 1, 2]) {
    const previewPng = resolve(DEBUG_DIR, `preview_t${t}.png`);
    const renderPng = resolve(DEBUG_DIR, `render_t${t}.png`);
    const diffPng = resolve(DEBUG_DIR, `diff_t${t}.png`);

    // Scale both images to 480×270 before diffing to average out H.264 quantization
    // noise. Measuring YAVG on the full 1920×1080 diff exaggerates sparse sub-pixel
    // differences by 8× vs a downscaled comparison. format=rgb24 prevents the lavfi
    // movie= filter from converting the PNG to limited-range yuv420p (which would add
    // a ~16-unit Y offset on Linux ffmpeg builds, inflating every YAVG reading by ~16).
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      previewPng,
      "-i",
      renderPng,
      "-filter_complex",
      "[0:v]scale=480:270[p];[1:v]scale=480:270[r];[p][r]blend=all_mode=difference",
      diffPng,
    ]);

    const probe = JSON.parse(
      execFileSync("ffprobe", [
        "-v",
        "quiet",
        "-of",
        "json",
        "-show_frames",
        "-select_streams",
        "v",
        "-f",
        "lavfi",
        `movie=${diffPng},format=rgb24,signalstats`,
      ]).toString(),
    ) as { frames: Array<{ tags?: Record<string, string> }> };

    const yavg = parseFloat(probe.frames[0]?.tags?.["lavfi.signalstats.YAVG"] ?? "0");
    yavgScores[`t${t}`] = yavg;
    if (yavg > MAX_YAVG) {
      failures.push(
        `t=${t}s: YAVG=${yavg.toFixed(2)}/255 exceeds ${MAX_YAVG} threshold (${((yavg / 255) * 100).toFixed(2)}%)`,
      );
    }
  }

  writeFileSync(resolve(DEBUG_DIR, "yavg.json"), JSON.stringify(yavgScores), "utf-8");

  if (failures.length > 0) {
    throw new Error(
      `Preview/render mismatch detected:\n${failures.join("\n")}\nSee diff images in: ${DEBUG_DIR}`,
    );
  }
});
