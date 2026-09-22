import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listCandidates, formatCandidates, CANDIDATE_CAP } from "./candidates.mjs";
import { findGlobalBySha } from "./cache.mjs";

// candidates + findGlobalBySha are offline (no heygen), so we can override HOME
// to a temp dir and seed a fake global ~/.media manifest deterministically.
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "mu-cand-"));
  const project = join(root, "proj");
  const home = join(root, "home");
  process.env.HOME = home;
  return { root, project, home };
}
function seedManifest(dir, records) {
  const md = join(dir, ".media");
  mkdirSync(md, { recursive: true });
  writeFileSync(md + "/manifest.jsonl", records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}
function proj(id, type, description, prompt) {
  return { id, type, path: `.media/audio/bgm/${id}.wav`, description, provenance: { prompt } };
}
function glob(id, type, description, prompt, sha) {
  return {
    id,
    type,
    sha,
    reusable: true,
    cached_path: `/x/${sha}/${id}.wav`,
    description,
    provenance: { prompt, provider: "heygen.audio.sounds" },
  };
}

test("ranks project + global by overlap, tags scope", () => {
  const { root, project, home } = sandbox();
  try {
    seedManifest(project, [proj("bgm_001", "bgm", "calm ambient piano", "calm ambient piano")]);
    seedManifest(home, [
      glob("bgm_009", "bgm", "energetic tech launch", "energetic tech launch", "a".repeat(64)),
      glob("bgm_010", "bgm", "sad corporate piano", "sad corporate piano", "b".repeat(64)),
    ]);
    const { candidates } = listCandidates({
      projectDir: project,
      type: "bgm",
      intent: "tech launch",
    });
    assert.equal(candidates[0].scope, "project"); // project listed first
    const g = candidates.filter((c) => c.scope === "global");
    assert.equal(g[0].description, "energetic tech launch"); // higher overlap ranks first
    assert.ok(g[0].score >= g[1].score);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("zero-overlap intent still lists candidates (no hard filter)", () => {
  const { root, project, home } = sandbox();
  try {
    seedManifest(project, []);
    seedManifest(home, [glob("bgm_009", "bgm", "driving synth", "driving synth", "c".repeat(64))]);
    const { candidates, similar } = listCandidates({
      projectDir: project,
      type: "bgm",
      intent: "totally unrelated words xyz",
    });
    assert.equal(candidates.length, 1, "listed despite zero overlap");
    assert.equal(candidates[0].score, 0);
    assert.equal(similar, 0, "similar counts only overlap>0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("caps per scope and reports truncation + totals", () => {
  const { root, project, home } = sandbox();
  try {
    const many = Array.from({ length: CANDIDATE_CAP + 3 }, (_, i) =>
      glob(`bgm_${i}`, "bgm", `track ${i}`, `track ${i}`, String(i).padStart(64, "0")),
    );
    seedManifest(project, []);
    seedManifest(home, many);
    const { candidates, truncated, total } = listCandidates({ projectDir: project, type: "bgm" });
    assert.equal(candidates.length, CANDIDATE_CAP);
    assert.equal(truncated, true);
    assert.equal(total.global, CANDIDATE_CAP + 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("honors icon<->image adjacency", () => {
  const { root, project, home } = sandbox();
  try {
    seedManifest(project, []);
    seedManifest(home, [glob("image_1", "image", "rocket logo", "rocket logo", "d".repeat(64))]);
    const { candidates } = listCandidates({ projectDir: project, type: "icon", intent: "rocket" });
    assert.equal(candidates.length, 1, "image asset surfaces for icon request");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sha only on global, path only on project", () => {
  const { root, project, home } = sandbox();
  try {
    seedManifest(project, [proj("bgm_001", "bgm", "x", "x")]);
    seedManifest(home, [glob("bgm_009", "bgm", "y", "y", "e".repeat(64))]);
    const { candidates } = listCandidates({ projectDir: project, type: "bgm" });
    const p = candidates.find((c) => c.scope === "project");
    const g = candidates.find((c) => c.scope === "global");
    assert.ok(p.path && !p.sha);
    assert.ok(g.sha && !g.path);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findGlobalBySha resolves unique prefix, flags ambiguity, misses cleanly", () => {
  const { root, project, home } = sandbox();
  try {
    seedManifest(project, []);
    seedManifest(home, [
      glob("bgm_1", "bgm", "a", "a", "abc" + "0".repeat(61)),
      glob("bgm_2", "bgm", "b", "b", "abd" + "0".repeat(61)),
      glob("bgm_3", "bgm", "c", "c", "fff" + "0".repeat(61)),
    ]);
    assert.equal(findGlobalBySha("fff").id, "bgm_3", "unique prefix resolves");
    assert.deepEqual(
      { ambiguous: findGlobalBySha("ab").ambiguous, count: findGlobalBySha("ab").count },
      { ambiguous: true, count: 2 },
      "ambiguous prefix flagged",
    );
    assert.equal(findGlobalBySha("zzz"), null, "miss returns null");
    assert.equal(findGlobalBySha(""), null, "empty returns null");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("formatCandidates shows reuse handles by scope; empty message", () => {
  const { candidates } = {
    candidates: [
      { scope: "project", description: "p", path: ".media/audio/bgm/bgm_001.wav" },
      { scope: "global", description: "g", sha: "f".repeat(64) },
    ],
  };
  const out = formatCandidates(candidates, {});
  assert.match(out, /\.media\/audio\/bgm\/bgm_001\.wav/);
  assert.match(out, /--reuse ffffffffffffffff/);
  assert.match(formatCandidates([], {}), /no reuse candidates/);
});
