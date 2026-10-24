// @vitest-environment node
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { bundleToSingleHtml } from "./htmlBundler";

const checked = vi.hoisted(() => [] as string[]);

vi.mock("../safePath.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../safePath.js")>();
  return {
    ...actual,
    isSafePath: (base: string, resolved: string) => {
      checked.push(resolved);
      return actual.isSafePath(base, resolved);
    },
  };
});

const dir = mkdtempSync(join(tmpdir(), "hf-bundle-entry-paths-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  checked.length = 0;
});
const repeatsIn = (paths: string[]) => paths.filter((path, at) => paths.indexOf(path) !== at);

it("checks each project path once per build, however many times a sub-composition is mounted", async () => {
  mkdirSync(join(dir, "compositions"), { recursive: true });
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "logo.png"), "png");
  writeFileSync(join(dir, "compositions", "texture.png"), "png");
  writeFileSync(
    join(dir, "compositions", "card.html"),
    `<!doctype html><html><head><style>
.card { background: url(../assets/logo.png); }
.card .bg { background: url(texture.png); }
</style></head><body>
<div data-composition-id="card" data-width="320" data-height="180" data-start="0" data-duration="2">
  <div class="bg"></div>
</div></body></html>`,
  );
  const mount = (start: number) =>
    `<div data-composition-id="card" data-composition-src="compositions/card.html" data-start="${start}"` +
    ` data-duration="2"></div>`;
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><body>
<div data-composition-id="main" data-width="320" data-height="180" data-start="0" data-duration="6">
${[0, 2, 4].map(mount).join("\n")}
</div>
<script>window.__timelines = {};</script>
</body></html>`,
  );

  const bundled = await bundleToSingleHtml(dir, { inlineAssets: false });

  expect(bundled).toContain("url(compositions/texture.png)");
  expect(bundled).toContain("url(assets/logo.png)");
  expect(repeatsIn(checked)).toEqual([]);
});

it("inlines each asset of a scene mounted many times after one check and one read of its path", async () => {
  const project = mkdtempSync(join(dir, "inline-"));
  mkdirSync(join(project, "compositions"), { recursive: true });
  mkdirSync(join(project, "assets", "real"), { recursive: true });
  writeFileSync(join(project, "assets", "real", "logo.png"), "linked-png");
  // Windows needs a privilege to create symlinks; a copy builds the same page.
  const link = join(project, "assets", "logo.png");
  if (process.platform === "win32") copyFileSync(join(project, "assets", "real", "logo.png"), link);
  else symlinkSync(join("real", "logo.png"), link);
  writeFileSync(join(project, "compositions", "grain.png"), "grain-png");
  writeFileSync(
    join(project, "compositions", "card.html"),
    `<!doctype html><html><head><style>
.card { background: url(../assets/logo.png); }
.card .bg { background: url(grain.png), url(../assets/missing.png); }
</style></head><body>
<div data-composition-id="card" data-width="320" data-height="180">
  <img src="../assets/logo.png" alt=""><div class="bg" style="mask: url(../assets/logo.png)"></div>
</div></body></html>`,
  );
  const mounts = [0, 2, 4, 6].map(
    (start) =>
      `<div data-composition-id="card" data-composition-src="compositions/card.html" data-start="${start}" data-duration="2"></div>`,
  );
  writeFileSync(
    join(project, "index.html"),
    `<!doctype html><html><body>
<div data-composition-id="main" data-width="320" data-height="180" data-start="0" data-duration="8">
${mounts.join("\n")}
</div>
<script>window.__timelines = {};</script>
</body></html>`,
  );
  const reads: string[] = [];

  const bundled = await bundleToSingleHtml(project, { onRead: (path) => reads.push(path) });

  const logo = `data:image/png;base64,${Buffer.from("linked-png").toString("base64")}`;
  expect(bundled.split(`url(${logo})`)).toHaveLength(1 + 8);
  expect(bundled.split(`src="${logo}"`)).toHaveLength(1 + 4);
  expect(bundled).toContain(
    `url(data:image/png;base64,${Buffer.from("grain-png").toString("base64")})`,
  );
  expect(bundled).toContain("url(assets/missing.png)");
  expect(checked).toContain(join(project, "assets", "missing.png"));
  expect(repeatsIn(checked)).toEqual([]);
  expect(reads).toContain(join(project, "assets", "logo.png"));
  expect(repeatsIn(reads)).toEqual([]);
});
