// @vitest-environment node
import { expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

it("derives the composition viewport and DPR 1 from raw font-localize stdin", () => {
  const cache = mkdtempSync(join(tmpdir(), "hf-font-stdin-"));
  try {
    const mainUrl = new URL("./fontLocalizeCli.ts", import.meta.url).href;
    const preload = join(cache, "fetch-fixture.mjs");
    const noNetwork = new URL("../../producer/scripts/no-network.mjs", import.meta.url).href;
    // A deterministic missing Google family allows the existing bundled-font fallback in fail-closed mode.
    writeFileSync(
      preload,
      "await import(" +
        JSON.stringify(noNetwork) +
        "); " +
        "const denied = globalThis.fetch; globalThis.fetch = async (input, init) => { " +
        "const url = input instanceof Request ? input.url : String(input); " +
        "if (new URL(url).hostname === 'fonts.googleapis.com') return new Response('', { status: 404 }); " +
        "return denied(input, init); };",
    );

    const result = spawnSync(
      "bun",
      [
        "--preload",
        preload,
        "--eval",
        "const { main } = await import(" +
          JSON.stringify(mainUrl) +
          "); process.exitCode = await main();",
      ],
      {
        input:
          '<html><head><style>@media (width < 1000px) and (resolution: 1dppx) { p { font-family: Inter; } }</style></head><body><main data-composition-id="main" data-width="640" data-height="360"><p>Small composition</p></main></body></html>',
        encoding: "utf8",
        timeout: 20_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, HYPERFRAMES_FONT_CACHE_DIR: cache },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('data-hyperframes-deterministic-fonts="true"');
    expect(result.stdout).toContain('font-family: "Inter";');
    expect(result.stdout).toContain('name="hyperframes-font-compiler-version"');
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});
