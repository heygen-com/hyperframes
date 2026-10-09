#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFESTS = [
  "plugin.json",
  "gemini-extension.json",
  ".claude-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  ".codex-plugin/plugin.json",
];

function validateManifests(read) {
  const portable = read("plugin.json");
  assert.equal(
    portable.$schema,
    "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    "Unexpected Agent Plugins schema",
  );
  assert.equal(portable.name, "hyperframes", "Invalid plugin identity");
  assert.match(
    String(portable.version),
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
    "Invalid plugin release version",
  );
  for (const path of MANIFESTS) {
    const manifest = read(path);
    assert.equal(manifest.name, portable.name, `Plugin identity mismatch: ${path}`);
    assert.equal(manifest.version, portable.version, `Plugin version mismatch: ${path}`);
  }
  assert.equal(
    read("packages/cli/package.json").version,
    portable.version,
    "Plugin and CLI versions must match",
  );
  return portable;
}

function payloadPaths(read) {
  const codex = read(".codex-plugin/plugin.json");
  const assets = [
    ...new Set(
      [
        codex.interface.logo,
        codex.interface.composerIcon,
        read(".cursor-plugin/plugin.json").logo,
      ].map((p) => p.replace(/^\.\//, "")),
    ),
  ];
  if (assets.some((p) => !/^assets\/[\w.-]+$/.test(p))) throw new Error("Unsafe plugin asset path");
  return [...MANIFESTS, ...assets, "LICENSE", "skills", "skills-manifest.json"];
}

// Package committed files only, including metadata. Dirty manifests must not
// describe a different release from the files git archive actually exports.
export function packagePlugin(root = ROOT) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const read = (path) => JSON.parse(git("show", `HEAD:${path}`));
  const portable = validateManifests(read);
  const source = git("rev-parse", "HEAD").trim();
  const published = Object.keys(read("skills-manifest.json").skills).sort();
  const skills = git("ls-tree", "-r", "--name-only", "HEAD", "skills").trim().split("\n");
  const found = skills
    .filter((p) => /^skills\/[^/]+\/SKILL.md$/.test(p))
    .map((p) => p.split("/")[1])
    .sort();
  if (JSON.stringify(found) !== JSON.stringify(published))
    throw new Error("Plugin skills differ from the published catalog");
  const paths = payloadPaths(read);
  for (const path of paths) git("cat-file", "-e", `HEAD:${path}`);
  const out = join(root, "dist");
  mkdirSync(out, { recursive: true });
  const archive = join(out, "hyperframes-agent-plugin.zip");
  git(
    "archive",
    "--format=zip",
    "--prefix=hyperframes/",
    "--output",
    archive,
    "HEAD",
    "--",
    ...paths,
  );
  const bytes = readFileSync(archive);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const metadata = {
    name: portable.name,
    version: portable.version,
    source,
    sha256,
    bytes: bytes.length,
    skills: published,
  };
  writeFileSync(
    join(out, "hyperframes-agent-plugin.json"),
    JSON.stringify(metadata, null, 2) + "\n",
  );
  writeFileSync(
    join(out, "hyperframes-agent-plugin.sha256"),
    `${sha256}  hyperframes-agent-plugin.zip\n`,
  );
  return metadata;
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(packagePlugin(), null, 2));
}
