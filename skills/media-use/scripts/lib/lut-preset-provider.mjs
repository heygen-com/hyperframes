import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withReservedFile, withReservedFileSync } from "./manifest.mjs";
import { freezeUrl } from "./freeze.mjs";
import { tokenOverlap } from "./match.mjs";
import { buildCube } from "./cube-build.mjs";
import { validateCube, validateCubeFile } from "./cube-validate.mjs";

const SKILL_DIR = join(import.meta.dirname, "..", "..");
const LUT_DIR = join(SKILL_DIR, "luts");
const LUT_INDEX = join(LUT_DIR, "index.json");
export const LIBRARY_LUT_OFFLINE_CODE = "MEDIA_USE_LIBRARY_LUT_OFFLINE";

// Mirrored from packages/core/src/colorGrading.ts HfColorGradingPresetId.
// Keep this list in lockstep with the core runtime contract.
export const CORE_PRESET_IDS = [
  "neutral",
  "natural-lift",
  "fresh-pop",
  "warm-daylight",
  "clean-studio",
  "skin-soft",
  "food-pop",
  "night-lift",
  "muted-editorial",
  "vintage-wash",
  "mono-clean",
  "mono-fade",
  "warm-clean",
  "cool-clean",
  "soft-boost",
  "bright-pop",
  "deep-contrast",
];

const PRESET_SYNONYMS = {
  neutral: ["neutral", "identity", "none", "ungraded", "natural base"],
  "natural-lift": ["natural lift", "natural light", "gentle lift", "soft natural"],
  "fresh-pop": ["fresh pop", "fresh", "bright fresh", "clean colorful"],
  "warm-daylight": [
    "warm daylight",
    "warm natural light",
    "golden daylight",
    "sunlit",
    "warm sunny",
  ],
  "clean-studio": ["clean studio", "studio clean", "cool studio", "product studio"],
  "skin-soft": ["skin soft", "soft skin", "portrait soft", "beauty skin"],
  "food-pop": ["food pop", "food vibrant", "appetizing", "restaurant color"],
  "night-lift": ["night lift", "night", "low light lift", "city night"],
  "muted-editorial": ["muted editorial", "editorial muted", "magazine muted"],
  "vintage-wash": ["vintage wash", "vintage", "retro wash", "aged film"],
  "mono-clean": ["mono clean", "black white clean", "monochrome clean"],
  "mono-fade": ["mono fade", "black white fade", "faded monochrome"],
  "warm-clean": ["warm clean", "clean warm", "warm product"],
  "cool-clean": ["cool clean", "clean cool", "cool crisp"],
  "soft-boost": ["soft boost", "soft bright", "gentle boost"],
  "bright-pop": ["bright pop", "bright punchy", "vivid bright"],
  "deep-contrast": ["deep contrast", "high contrast punchy", "punchy contrast", "bold contrast"],
};

function presetCandidates() {
  return CORE_PRESET_IDS.map((id) => ({
    kind: "preset",
    preset: id,
    synonyms: PRESET_SYNONYMS[id] ?? [],
    text: [id, ...(PRESET_SYNONYMS[id] ?? [])].join(" "),
  }));
}

export function readBundledLutIndex() {
  if (!existsSync(LUT_INDEX)) return [];
  const parsed = JSON.parse(readFileSync(LUT_INDEX, "utf8"));
  const entries = Array.isArray(parsed) ? parsed : parsed.looks;
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => {
    const params =
      entry.params && typeof entry.params === "object" && !Array.isArray(entry.params)
        ? entry.params
        : null;
    const url = typeof entry.url === "string" && entry.url.trim() ? entry.url.trim() : null;
    return {
      id: String(entry.id),
      description: String(entry.description ?? entry.id),
      tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
      intensity: Number.isFinite(Number(entry.intensity)) ? Number(entry.intensity) : 1,
      ...(params && { params }),
      ...(url && { url }),
    };
  });
}

function libraryCandidates() {
  return readBundledLutIndex().map((entry) => ({
    kind: "library",
    ...entry,
    text: [entry.id, entry.description, ...entry.tags].join(" "),
  }));
}

export function matchColorLook(intent) {
  const normalized = String(intent ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  for (const candidate of presetCandidates()) {
    if (candidate.preset === normalized) {
      return { kind: "preset", preset: candidate.preset, score: 99 };
    }
  }

  const candidates = [...presetCandidates(), ...libraryCandidates()]
    .map((candidate, index) => ({
      ...candidate,
      index,
      score: tokenOverlap(intent, candidate.text),
    }))
    .filter((candidate) => candidate.score >= 2)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (candidates.length === 0) return null;
  const best = candidates[0];
  if (best.kind === "preset") {
    return { kind: "preset", preset: best.preset, score: best.score };
  }
  return {
    kind: "library",
    id: best.id,
    description: best.description,
    tags: best.tags,
    intensity: best.intensity,
    ...(best.params && { params: best.params }),
    ...(best.url && { url: best.url }),
    score: best.score,
  };
}

export function isLibraryLutOfflineMiss(err) {
  return err?.code === LIBRARY_LUT_OFFLINE_CODE;
}

function libraryRecord(match, { id, localPath, fullPath, via }) {
  return {
    id,
    localPath,
    fullPath,
    lut: { src: localPath, intensity: match.intensity },
    source: "library",
    description: match.description,
    metadata: {
      provider: "cube_lut.library",
      provenance: {
        look_id: match.id,
        tags: match.tags,
        via,
      },
    },
  };
}

function assertValidCubeText(cube, label) {
  const check = validateCube(cube);
  if (!check.ok) throw new Error(`${label}: ${check.error}`);
}

function assertValidCubeFile(path, label) {
  const check = validateCubeFile(path);
  if (!check.ok) throw new Error(`${label}: ${check.error}`);
}

function offlineLibraryMiss(match) {
  const err = new Error(`library LUT "${match.id}" is CDN-only and --local-only is set`);
  err.code = LIBRARY_LUT_OFFLINE_CODE;
  return err;
}

export async function freezeLibraryLut(match, { projectDir, type, localOnly = false }) {
  if (!match || match.kind !== "library") {
    throw new Error("freezeLibraryLut requires a library match");
  }

  // Prefer the CDN url so looks download on-demand (like bgm/image). Fall back
  // to deterministic buildCube params when offline (--local-only) or if the
  // download/validation fails, so resolution is never blocked on the network.
  if (match.url && !localOnly) {
    try {
      return await withReservedFile(
        projectDir,
        type,
        ".cube",
        async ({ id, localPath, fullPath }) => {
          const tmpPath = `${fullPath}.tmp`;
          try {
            // Download + validate at a .tmp path, then atomically rename. A crash
            // (SIGKILL/OOM) between write and validate can't orphan an invalid .cube
            // at the final path — only a validated cube is ever renamed into place.
            await freezeUrl(match.url, tmpPath);
            assertValidCubeFile(tmpPath, `downloaded library LUT ${match.id} failed validation`);
            renameSync(tmpPath, fullPath);
            return libraryRecord(match, { id, localPath, fullPath, via: "url" });
          } finally {
            rmSync(tmpPath, { force: true });
          }
        },
      );
    } catch (err) {
      if (!match.params) {
        throw new Error(`failed to freeze library LUT ${match.id}: ${err.message}`);
      }
      // else: fall through to the params fallback below
    }
  }

  if (match.params) {
    return withReservedFileSync(projectDir, type, ".cube", ({ id, localPath, fullPath }) => {
      const tmpPath = `${fullPath}.tmp`;
      try {
        const cube = buildCube(match.params);
        assertValidCubeText(cube, `invalid library LUT ${match.id}`);
        // Write + validate at .tmp, then atomic rename — same no-orphan guarantee
        // as the url path above.
        writeFileSync(tmpPath, cube);
        assertValidCubeFile(tmpPath, `invalid frozen LUT ${localPath}`);
        renameSync(tmpPath, fullPath);
        return libraryRecord(match, {
          id,
          localPath,
          fullPath,
          via: match.url ? "params-fallback" : "params",
        });
      } finally {
        rmSync(tmpPath, { force: true });
      }
    });
  }

  if (match.url) throw offlineLibraryMiss(match); // url-only entry, offline
  throw new Error(`misconfigured library LUT "${match.id}": expected params or url`);
}
