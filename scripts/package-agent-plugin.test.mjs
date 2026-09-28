// guards: scripts/package-agent-plugin.mjs, plugin.json, gemini-extension.json, .claude-plugin/**, .codex-plugin/**, .cursor-plugin/**, skills/**, skills-manifest.json, assets/**, LICENSE, packages/cli/package.json
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { packagePlugin } from "./package-agent-plugin.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "hf-package-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: root,
      encoding: "utf8",
    });
  const write = (path, value) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
  };
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  const manifest = { name: "hyperframes", version: "1.2.3" };
  write("plugin.json", {
    ...manifest,
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  });
  write("gemini-extension.json", manifest);
  write(".claude-plugin/plugin.json", manifest);
  write(".cursor-plugin/plugin.json", { ...manifest, logo: "assets/logo.png" });
  write(".codex-plugin/plugin.json", {
    ...manifest,
    interface: { logo: "./assets/logo.png", composerIcon: "./assets/icon.png" },
  });
  write("packages/cli/package.json", manifest);
  write("skills-manifest.json", { skills: { hyperframes: {} } });
  write("skills/hyperframes/SKILL.md", "bundled skill");
  write(".claude/skills/internal/SKILL.md", "private contributor workflow");
  write("assets/logo.png", "logo");
  write("assets/icon.png", "icon");
  write("LICENSE", "license");
  git("add", ".");
  git("commit", "-qm", "fixture");
  return { root, git, write };
}

test("archives committed release, excludes internals, and records reproducible provenance", (t) => {
  const { root, write } = fixture(t);
  write("plugin.json", { version: "dirty" });
  write("skills/hyperframes/SKILL.md", "uncommitted change");
  const first = packagePlugin(root);
  const second = packagePlugin(root);
  assert.deepEqual(first, second);
  assert.equal(first.version, "1.2.3");
  assert.deepEqual(first.skills, ["hyperframes"]);
  const zip = join(root, "dist/hyperframes-agent-plugin.zip");
  assert.equal(first.sha256, createHash("sha256").update(readFileSync(zip)).digest("hex"));
  const files = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" });
  assert.match(files, /hyperframes\/LICENSE/);
  assert.doesNotMatch(files, /internal|packages\/|marketplace.json/);
  assert.equal(
    execFileSync("unzip", ["-p", zip, "hyperframes/skills/hyperframes/SKILL.md"], {
      encoding: "utf8",
    }),
    "bundled skill",
  );
});

test("rejects mismatched client versions before creating an artifact", (t) => {
  const { root, git, write } = fixture(t);
  write("gemini-extension.json", { name: "hyperframes", version: "1.2.4" });
  git("add", ".");
  git("commit", "-qm", "mismatch");
  assert.throws(() => packagePlugin(root), /mismatch: gemini-extension.json/);
});

test("rejects a skill missing from the published catalog", (t) => {
  const { root, git, write } = fixture(t);
  write("skills/unpublished/SKILL.md", "not published");
  git("add", ".");
  git("commit", "-qm", "unpublished");
  assert.throws(() => packagePlugin(root), /published catalog/);
});
