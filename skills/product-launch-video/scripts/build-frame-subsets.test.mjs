import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflows = ["product-launch-video", "faceless-explainer", "pr-to-video"];
const css = `<style>
/* cyrillic */
@font-face { font-family: 'Manrope'; font-style: normal; font-weight: 200 800;
  src: url(assets/fonts/aaa.woff2) format('woff2'); unicode-range: U+0400-045F; }
/* latin */
@font-face { font-family: 'Manrope'; font-style: normal; font-weight: 200 800;
  src: url("assets/fonts/zzz.woff2") format('woff2'); unicode-range: U+0000-00FF; }
</style>`;

for (const skill of workflows) {
  const scripts = new URL("../../" + skill + "/scripts/", import.meta.url);
  const { brandFontFaces } = await import(new URL("captions.mjs", scripts));
  test(skill + " stages every captured subset and captions preserve the same coverage", () => {
    const project = mkdtempSync(join(tmpdir(), "frame-subsets-"));
    try {
      mkdirSync(join(project, "capture/extracted"), { recursive: true });
      mkdirSync(join(project, "capture/assets/fonts"), { recursive: true });
      writeFileSync(
        join(project, "capture/extracted/tokens.json"),
        JSON.stringify({ fonts: [{ family: "Manrope" }] }),
      );
      writeFileSync(join(project, "capture/extracted/page.html"), css);
      writeFileSync(join(project, "capture/assets/fonts/aaa.woff2"), "cyrillic bytes");
      writeFileSync(join(project, "capture/assets/fonts/zzz.woff2"), "latin bytes");
      for (let pass = 0; pass < 2; pass++) {
        execFileSync(
          process.execPath,
          [
            fileURLToPath(new URL("build-frame.mjs", scripts)),
            "--preset",
            "capsule",
            "--hyperframes",
            project,
          ],
          { stdio: "pipe" },
        );
        const frame = readFileSync(join(project, "frame.md"), "utf8");
        const captions = brandFontFaces(join(project, "frame.md"), project);
        for (const output of [frame, captions]) {
          assert.match(output, /unicode-range:\s*U\+0400-045F/);
          assert.match(output, /unicode-range:\s*U\+0000-00FF/);
          assert.equal((output.match(/font-weight:\s*200 800/g) ?? []).length, 2);
          assert.equal((output.match(/@font-face/g) ?? []).length, 2);
          for (const match of output.matchAll(/url\(["']?(assets\/fonts\/[^"')]+)["']?\)/g)) {
            assert.ok(
              ["cyrillic bytes", "latin bytes"].includes(
                readFileSync(join(project, match[1]), "utf8"),
              ),
            );
          }
        }
        assert.equal(readdirSync(join(project, "assets/fonts")).length, 2);
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
}

test("captured font helper copies stay equal to the owner", () => {
  const owner = readFileSync(new URL("./lib/captured-fonts.mjs", import.meta.url), "utf8");
  for (const skill of workflows.slice(1)) {
    assert.equal(
      readFileSync(
        new URL("../../" + skill + "/scripts/lib/captured-fonts.mjs", import.meta.url),
        "utf8",
      ),
      owner,
    );
  }
});

test("captured rules stage only available local sources for requested families", async () => {
  const { stageCapturedFonts } = await import("./lib/captured-fonts.mjs");
  const project = mkdtempSync(join(tmpdir(), "captured-font-sources-"));
  try {
    mkdirSync(join(project, "capture/extracted"), { recursive: true });
    mkdirSync(join(project, "capture/assets/fonts"), { recursive: true });
    writeFileSync(join(project, "capture/assets/fonts/local.woff2"), "first");
    writeFileSync(
      join(project, "capture/extracted/page.html"),
      `<style>
      @font-face { font-family: Other; src: url(assets/fonts/local.woff2); }
      @font-face { font-family: Manrope; font-weight: 600; unicode-range: U+0000-00FF;
        src: local(Manrope), url(https://example.com/remote.woff2), url(assets/fonts/missing.woff2), url(assets/fonts/local.woff2) format("woff2"); }
    </style>`,
    );
    const first = stageCapturedFonts(project, ["Manrope"]);
    assert.equal(first.faces.length, 1);
    assert.deepEqual([...first.families], ["manrope"]);
    assert.doesNotMatch(first.faces[0], /Other|https:|missing|local\(/);
    assert.match(first.faces[0], /unicode-range: U\+0000-00FF/);
    const [file] = first.files;
    assert.equal(readFileSync(join(project, file), "utf8"), "first");
    writeFileSync(join(project, "capture/assets/fonts/local.woff2"), "refreshed");
    stageCapturedFonts(project, ["Manrope"]);
    assert.equal(readFileSync(join(project, file), "utf8"), "refreshed");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

for (const skill of workflows) {
  test(
    skill + " keeps captured family ownership when downloads are missing or names overlap",
    async () => {
      const { brandFontFaces } = await import(
        new URL("../../" + skill + "/scripts/captions.mjs", import.meta.url)
      );
      const project = mkdtempSync(join(tmpdir(), "font-ownership-"));
      try {
        mkdirSync(join(project, "capture/extracted"), { recursive: true });
        mkdirSync(join(project, "capture/assets/fonts"), { recursive: true });
        writeFileSync(
          join(project, "frame.md"),
          'typography:\n  display: { fontFamily: "TT Norms Pro Mono", weight: 400 }\n  body: { fontFamily: "TT Norms Pro", weight: 400 }\n',
        );
        writeFileSync(
          join(project, "capture/assets/fonts/TT_Norms_Pro_Mono_Regular.woff2"),
          "mono",
        );
        writeFileSync(
          join(project, "capture/extracted/page.html"),
          `<style>
        @font-face { font-family: 'TT Norms Pro Mono'; src: url(assets/fonts/TT_Norms_Pro_Mono_Regular.woff2); unicode-range: U+0000-00FF; }
      </style>`,
        );
        const mixed = brandFontFaces(join(project, "frame.md"), project);
        assert.equal((mixed.match(/@font-face/g) ?? []).length, 1);
        assert.doesNotMatch(mixed, /font-family: 'TT Norms Pro';/);
        writeFileSync(
          join(project, "capture/extracted/page.html"),
          `<style>
        @font-face { font-family: 'TT Norms Pro Mono'; src: url(assets/fonts/missing.woff2); }
      </style>`,
        );
        assert.equal(brandFontFaces(join(project, "frame.md"), project), "");
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    },
  );
}
