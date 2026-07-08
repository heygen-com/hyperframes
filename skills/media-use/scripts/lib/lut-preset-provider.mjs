import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { allocateId } from "./manifest.mjs";
import { freezeLocalFile } from "./freeze.mjs";
import { tokenOverlap } from "./match.mjs";
import { validateCubeFile } from "./cube-validate.mjs";

const SKILL_DIR = join(import.meta.dirname, "..", "..");
const LUT_DIR = join(SKILL_DIR, "luts");
const LUT_INDEX = join(LUT_DIR, "index.json");

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
  return entries.map((entry) => ({
    id: String(entry.id),
    file: String(entry.file),
    description: String(entry.description ?? entry.id),
    tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
    intensity: Number.isFinite(Number(entry.intensity)) ? Number(entry.intensity) : 1,
  }));
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
    file: best.file,
    description: best.description,
    tags: best.tags,
    intensity: best.intensity,
    score: best.score,
  };
}

export function freezeLibraryLut(match, { projectDir, type }) {
  if (!match || match.kind !== "library") {
    throw new Error("freezeLibraryLut requires a library match");
  }
  const srcPath = join(LUT_DIR, match.file);
  const sourceCheck = validateCubeFile(srcPath);
  if (!sourceCheck.ok) {
    throw new Error(`invalid bundled LUT ${match.file}: ${sourceCheck.error}`);
  }
  const { id, localPath } = allocateId(projectDir, type, extname(match.file) || ".cube");
  const fullPath = join(projectDir, localPath);
  freezeLocalFile(srcPath, fullPath);
  const frozenCheck = validateCubeFile(fullPath);
  if (!frozenCheck.ok) {
    throw new Error(`invalid frozen LUT ${localPath}: ${frozenCheck.error}`);
  }
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
      },
    },
  };
}
