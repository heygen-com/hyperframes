import { portablePrivatePattern } from "@hyperframes/parsers/private-path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  ManifestInvalid,
  localBaseDigest,
  parseCanonicalManifest,
  parseManifest,
  parseStoredManifest,
} from "../src/sources/manifest.mjs";
import { overLimit, V1_LIMITS } from "../src/sources/limits.mjs";
import { excludedFolder, skippedSymlink, validatePath } from "../src/sources/pathPolicy.mjs";

/** Reference vectors for the source manifest format. */
const vectors = JSON.parse(
  readFileSync(
    new URL("./fixtures/compositionSync/manifest-vectors.json", import.meta.url),
    "utf8",
  ),
);

/** @param {() => unknown} run */
function refusal(run) {
  try {
    run();
  } catch (error) {
    if (error instanceof ManifestInvalid) return error;
    throw error;
  }
  return null;
}

test("the vectors are portable-source-v12's, and there are vectors of every kind", () => {
  assert.equal(vectors.policy_version, "portable-source-v12");
  assert.deepEqual(
    [vectors.valid.length, vectors.invalid.length, vectors.limits.length, vectors.stored.length],
    [14, 243, 5, 8],
  );
});

test("every valid vector builds the server's canonical bytes and manifest_sha256", () => {
  for (const vector of vectors.valid) {
    const manifest = parseManifest(vector.manifest);
    assert.equal(manifest.canonical.toString("utf8"), vector.canonical, vector.name);
    assert.equal(manifest.sha256, vector.manifest_sha256, vector.name);
    assert.equal(
      createHash("sha256").update(Buffer.from(vector.canonical, "utf8")).digest("hex"),
      vector.manifest_sha256,
    );
    assert.equal(manifest.document.files.length, vector.file_count, vector.name);
    const bytes = manifest.document.files.reduce((sum, file) => sum + file.size, 0);
    assert.equal(bytes, vector.project_bytes, vector.name);
  }
});

test("every invalid vector is refused with the server's code and rule", () => {
  for (const vector of vectors.invalid) {
    const error = refusal(() => parseManifest(vector.manifest));
    assert.ok(error, `${vector.name} was accepted`);
    assert.equal(error.code, vector.error.code, vector.name);
    if (vector.error.rule) assert.equal(error.violations[0]?.rule, vector.error.rule, vector.name);
  }
});

test("every limits vector breaks the server's first limit, or none", () => {
  for (const vector of vectors.limits) {
    const manifest = parseManifest(vector.manifest);
    const limits = {
      maxFiles: vector.limits.max_files,
      maxFileBytes: vector.limits.max_file_bytes,
      maxProjectBytes: vector.limits.max_project_bytes,
      maxManifestBytes: vector.limits.max_manifest_bytes,
    };
    const over = overLimit(manifest.document.files, manifest.canonical.length, limits);
    assert.equal(over?.limit ?? null, vector.limit, vector.name);
  }
});

test("every stored vector reads only canonical bytes", () => {
  for (const vector of vectors.stored) {
    const body = Buffer.from(vector.body, "base64");
    const error = refusal(() => parseCanonicalManifest(body));
    assert.equal(error?.code ?? null, vector.error?.code ?? null, vector.name);
  }
});

test("V1 limits are 10,000 files, 5 GiB a file, 10 GiB a project and an 8 MiB manifest", () => {
  assert.deepEqual(V1_LIMITS, {
    maxFiles: 10000,
    maxFileBytes: 5368709120,
    maxProjectBytes: 10737418240,
    maxManifestBytes: 8388608,
  });
});

test("a project over a limit names its biggest files first", () => {
  const files = [
    { path: "index.html", size: 10 },
    { path: "assets/b.mp4", size: 6 * 1024 ** 3 },
    { path: "assets/a.mp4", size: 7 * 1024 ** 3 },
  ];
  const over = overLimit(files, 300);
  assert.equal(over?.limit, "file_size");
  assert.equal(over?.actual, 7 * 1024 ** 3);
  assert.deepEqual(
    over?.biggest.map((file) => file.path),
    ["assets/a.mp4", "assets/b.mp4", "index.html"],
  );
});

test("a capture skips only folders no included file can be under", () => {
  assert.equal(excludedFolder("node_modules"), true);
  assert.equal(excludedFolder("assets/node_modules"), true);
  assert.equal(excludedFolder(".git"), true);
  assert.equal(excludedFolder(".claude"), true);
  assert.equal(excludedFolder("dist"), true);
  assert.equal(excludedFolder("assets/dist"), false);
  assert.equal(excludedFolder("renders"), true);
  assert.equal(excludedFolder(".hyperframes"), false);
  assert.equal(excludedFolder(".hyperframes/prepared-assets"), false);
  assert.equal(excludedFolder("assets"), false);
  assert.equal(excludedFolder("assets/renders"), false);
});

function manifestWith(path, includeHidden = false) {
  const blob = { sha256: "0".repeat(64), size: 0 };
  return {
    format_version: 1,
    entrypoint: "index.html",
    files: [
      { path: "index.html", ...blob },
      { path, ...blob, ...(includeHidden && { include_hidden: true }) },
    ],
  };
}

for (const [name, path, rule] of [
  [
    "a hidden image with a fullwidth extension letter",
    "art/.icons/logo.\uFF50ng",
    "unrecognized-hidden",
  ],
  [
    "a hidden image in a compatibility spelling of the render folder",
    "\uFF52enders/.icons/logo.png",
    "root-generated-output",
  ],
]) {
  test(`a hidden marker refuses ${name}`, () => {
    const expected = { code: "excluded_path", path, rule };
    assert.throws(() => validatePath(path, "current", true), expected);
    assert.deepEqual(refusal(() => parseManifest(manifestWith(path, true)))?.violations, [
      expected,
    ]);
  });
}

test("a v4 base retains the digest of a path segment containing only a zero-width joiner", () => {
  const old = manifestWith("assets/\u200d/cover.svg");
  assert.equal(
    localBaseDigest(old),
    "67183e170a22454c5b4847c6774c9efc2912192294173e9c7e58d37c98625d6d",
  );
  assert.equal(refusal(() => parseStoredManifest(old))?.code, "path_empty_segment");
  assert.equal(refusal(() => parseManifest(old))?.code, "path_empty_segment");
  assert.equal(
    refusal(() => localBaseDigest(manifestWith("assets//cover.svg")))?.code,
    "path_empty_segment",
  );
});

test("an upload refuses a .hyperframes folder below the root; a stored snapshot still reads one", () => {
  const error = refusal(() => parseManifest(manifestWith("sub/.hyperframes/agent-runs.jsonl")));
  assert.equal(error?.code, "excluded_path");
  assert.equal(error?.violations[0]?.rule, "nested-hyperframes-state");
  assert.equal(
    parseManifest(manifestWith(".hyperframes/studio-motion.json")).document.files.length,
    2,
  );
  assert.equal(
    refusal(() => parseManifest(manifestWith(".hyperframes/agent-runs.jsonl")))?.violations[0]
      ?.rule,
    "known-hyperframes-state",
  );
  const stored = parseStoredManifest(manifestWith("sub/.hyperframes/agent-runs.jsonl"));
  assert.equal(stored.document.files.length, 2);
  assert.equal(excludedFolder("sub/.hyperframes"), true);
  assert.equal(excludedFolder(".hyperframes/transcripts/x/.hyperframes"), true);
});

test("only links under assets/podcast/, in any spelling, are skipped", () => {
  assert.equal(skippedSymlink("assets/podcast/cam-a.mov"), true);
  assert.equal(skippedSymlink("Assets/Podcast/raw/cam-a.mov"), true);
  assert.equal(skippedSymlink("assets/cam-a.mov"), false);
  assert.equal(skippedSymlink("other/assets/podcast/cam-a.mov"), false);
});

test("the portable contract tracks the complete parser private-path expression", () => {
  const policy = JSON.parse(
    readFileSync(new URL("../src/sources/contract/path-policy.json", import.meta.url), "utf8"),
  );
  assert.equal(
    policy.rules.find(({ id }) => id === "private-source").regex,
    portablePrivatePattern,
  );
});
