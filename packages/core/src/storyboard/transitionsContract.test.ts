// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const skillNames = ["faceless-explainer", "pr-to-video", "product-launch-video"];
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeProject({ preInflatedRoot = true } = {}): string {
  const project = mkdtempSync(join(tmpdir(), "hf-transition-tail-"));
  tempDirs.push(project);
  mkdirSync(join(project, "compositions"));
  writeFileSync(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1\n- status: built\n- duration: 2s\n- src: compositions/01.html\n\n## Frame 2\n- status: built\n- duration: 2s\n- src: compositions/02.html\n- transition_in: crossfade 0.5s\n`,
  );
  const rootDuration = preInflatedRoot ? 2.5 : 2;
  writeFileSync(
    join(project, "compositions", "01.html"),
    `<div data-composition-id="01" data-start="0" data-duration="${rootDuration}">
      <div id="ground" data-start="0" data-duration="2"></div>
      <div id="content" data-start="0.5" data-duration="1.5"></div>
      <audio id="voice" data-start="0" data-duration="2"></audio>
    </div>`,
  );
  writeFileSync(
    join(project, "compositions", "02.html"),
    `<div data-composition-id="02" data-start="0" data-duration="2"></div>`,
  );
  writeFileSync(
    join(project, "index.html"),
    `<div data-composition-id="main" data-start="0" data-duration="4">
      <div id="el-01" data-composition-id="01" data-composition-src="compositions/01.html" data-start="0" data-duration="2" data-track-index="1"></div>
      <div id="el-02" data-composition-id="02" data-composition-src="compositions/02.html" data-start="2" data-duration="2" data-track-index="1"></div>
    </div>
    <script>window.__timelines["main"] = gsap.timeline({ paused: true });</script>`,
  );
  return project;
}

describe.each(skillNames)("%s transition contract", (skillName) => {
  it.each([
    ["pre-inflated worker root", true],
    ["normal worker root", false],
  ])(
    "extends the outgoing frame root and visual tail clips across overlap (%s)",
    (_, preInflatedRoot) => {
      const project = makeProject({ preInflatedRoot });
      const script = join(REPO_ROOT, "skills", skillName, "scripts", "transitions.mjs");
      execFileSync(process.execPath, [script, "inject", "--hyperframes", project], {
        stdio: "pipe",
      });

      const frame = readFileSync(join(project, "compositions", "01.html"), "utf8");
      const index = readFileSync(join(project, "index.html"), "utf8");
      expect(frame).toContain('data-composition-id="01" data-start="0" data-duration="2.5"');
      expect(frame).toContain('id="ground" data-start="0" data-duration="2.5"');
      expect(frame).toContain('id="content" data-start="0.5" data-duration="2"');
      expect(frame).toContain('id="voice" data-start="0" data-duration="2"');
      expect(index).toMatch(/id="el-01"[^>]*data-duration="2.5"/);
    },
  );
});
