import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { appendRecord, mediaDir, nextId } from "./manifest.mjs";
import { regenerateIndex } from "./index-gen.mjs";
import { mergedPreferences } from "./prefs-store.mjs";

/**
 * Recipes — the heavyweight tier of HyperFrames user memory.
 *
 * A recipe is the full confirmed bundle for one video type: the frozen design
 * spec (`frame.md`), the storyboard skeleton (structure with the content
 * blanked), and the confirmed brief values — frozen after the run's final
 * approval, reused to start the next video of the same type from everything
 * already approved.
 *
 * Storage is **named folders**, not content-addressed cache entries: a recipe
 * is an evolving bundle with a `version`, so re-freezing the same name bumps
 * the version and archives the old folder as `<name>@v<N>`. Two tiers, same
 * split as everything else in media-use: project `.media/recipes/<name>/`
 * (committed) and user `~/.media/recipes/<name>/` (a freeze is already a
 * confirmed bundle, so it promotes immediately — no two-project rule here).
 */

/** Frontmatter keys that describe THIS video, not the reusable type. */
const FRONTMATTER_CONTENT_KEYS = new Set(["message", "audience", "mode"]);

/** BRIEF.md frontmatter keys that describe this run, not the reusable type —
 * a recipe never locks the run's shape, so the intent layer always re-asks. */
const BRIEF_CONTENT_KEYS = new Set(["flow", "storyboard", "message", "audience"]);

/** Per-frame metadata that is content, not structure. */
const FRAME_CONTENT_KEYS = new Set([
  "voiceover",
  "vo",
  "voice_over",
  "narration",
  "scene",
  "description",
  "summary",
  "caption",
  "asset_candidates",
]);

const FRAME_HEADING_RE = /^(#{2,3})\s+(?:frame|beat|scene)\s+\d+/i;

export function projectRecipesDir(projectDir) {
  return join(mediaDir(projectDir), "recipes");
}

export function userRecipesDir() {
  return join(homedir(), ".media", "recipes");
}

export function slugifyRecipeName(name) {
  const slug = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error(`recipe name "${name}" has no usable characters`);
  return slug;
}

function frameTitle(headingLine) {
  const dash = headingLine.split(/\s+—\s+/)[1];
  if (dash && dash.trim()) return dash.trim();
  return headingLine.replace(/^#+\s*/, "").trim();
}

/** Frontmatter: drop the content keys, keep structure/style keys verbatim. */
function skeletonFrontmatter(lines, out, contentKeys = FRONTMATTER_CONTENT_KEYS) {
  if (lines[0]?.trim() !== "---") return 0;
  out.push(lines[0]);
  let i = 1;
  while (i < lines.length && lines[i].trim() !== "---") {
    const key = lines[i].match(/^(\w+)\s*:/)?.[1]?.toLowerCase();
    if (!key || !contentKeys.has(key)) out.push(lines[i]);
    i++;
  }
  if (i < lines.length) {
    out.push(lines[i]); // closing ---
    i++;
  }
  return i;
}

/** One line inside a frame section — returns the replacement lines (may be none). */
function skeletonFrameLine(line, state, out) {
  const bulletKey = line.match(/^-\s+(\w+)\s*:/)?.[1]?.toLowerCase();
  if (bulletKey) {
    if (bulletKey === "status") out.push("- status: outline");
    else if (!FRAME_CONTENT_KEYS.has(bulletKey)) out.push(line);
    return;
  }
  if (!line.trim()) {
    out.push(line);
    return;
  }
  // Frame prose: one placeholder per frame in place of the narrative.
  if (!state.proseReplaced) {
    out.push(
      `<fill in: this video's content for the "${state.title}" beat — keep the layout role, replace the words.>`,
    );
    state.proseReplaced = true;
  }
}

/**
 * Skeletonize a STORYBOARD.md: keep the reusable structure (frame count,
 * durations, transitions, src paths, the Video direction block, style-ish
 * frontmatter), reset every status to `outline`, and blank the content
 * (message/audience, narration guides, per-frame prose) down to a fill-in
 * placeholder that names the frame's role.
 */
/**
 * Skeletonize a BRIEF.md: keep the frontmatter's reusable keys (workflow,
 * destination, aspect, language, length, angle…), drop the run-shape and
 * content keys (flow, storyboard, message, audience), and blank each body
 * section down to a fill-in placeholder under its kept heading.
 */
export function skeletonizeBrief(source) {
  const lines = String(source ?? "").split(/\r?\n/);
  const out = [];
  let i = skeletonFrontmatter(lines, out, BRIEF_CONTENT_KEYS);
  for (; i < lines.length; i++) {
    const heading = lines[i].match(/^##\s+(.+)$/);
    if (heading) {
      out.push(lines[i], "");
      out.push(
        `<fill in: this video's ${heading[1].trim().toLowerCase()} — the recipe keeps the shape, this run supplies the specifics.>`,
      );
      out.push("");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function skeletonizeStoryboard(source) {
  const lines = String(source ?? "").split(/\r?\n/);
  const out = [];
  const state = { inFrame: false, proseReplaced: false, title: "" };
  for (let i = skeletonFrontmatter(lines, out); i < lines.length; i++) {
    const line = lines[i];
    if (/^#{2,3}\s/.test(line)) {
      state.inFrame = FRAME_HEADING_RE.test(line);
      state.proseReplaced = false;
      state.title = state.inFrame ? frameTitle(line) : "";
      out.push(line);
    } else if (!state.inFrame) {
      out.push(line);
    } else {
      skeletonFrameLine(line, state, out);
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** The run's workflow as BRIEF.md records it — the source of truth a freeze
 * must not contradict. Undefined when no BRIEF.md (or no `workflow:`) exists. */
function briefWorkflow(root) {
  const brief = join(root, "BRIEF.md");
  if (!existsSync(brief)) return undefined;
  const lines = readFileSync(brief, "utf8").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return undefined;
  for (let i = 1; i < lines.length && lines[i].trim() !== "---"; i++) {
    const match = lines[i].match(/^workflow\s*:\s*(.+?)\s*$/);
    if (match) return match[1].replace(/^["']|["']$/g, "") || undefined;
  }
  return undefined;
}

function readRecipeJson(dir) {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "recipe.json"), "utf8"));
    if (typeof parsed !== "object" || parsed === null || typeof parsed.name !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function prefValue(prefs, key) {
  return prefs[key]?.value;
}

/**
 * Freeze the current project's approved run as a named recipe. Writes the
 * project-tier folder + a manifest record, then copies to the user tier (a
 * freeze is already confirmed — it promotes immediately).
 */
export function freezeRecipe({ projectDir, name, workflow, blocks }) {
  const slug = slugifyRecipeName(name);
  const root = resolve(projectDir);
  const fromBrief = briefWorkflow(root);
  const fromFlag = workflow && String(workflow).trim() ? String(workflow).trim() : undefined;
  // BRIEF.md decides; the flag only covers projects briefed before it existed.
  const resolvedWorkflow = fromBrief ?? fromFlag;
  if (!resolvedWorkflow) {
    throw new Error("no workflow found — BRIEF.md names none and no --workflow was given");
  }
  const frameSpec = join(root, "frame.md");
  const storyboard = join(root, "STORYBOARD.md");
  if (!existsSync(frameSpec)) throw new Error("no frame.md to freeze — run the design step first");
  if (!existsSync(storyboard)) throw new Error("no STORYBOARD.md to freeze");

  const dir = join(projectRecipesDir(root), slug);
  let version = 1;
  const previous = existsSync(dir) ? readRecipeJson(dir) : null;
  if (previous) {
    version = (Number.isInteger(previous.version) ? previous.version : 1) + 1;
    const archive = `${dir}@v${previous.version ?? 1}`;
    rmSync(archive, { recursive: true, force: true });
    renameSync(dir, archive);
  }
  mkdirSync(dir, { recursive: true });

  const prefs = mergedPreferences(root);
  const recipe = {
    version,
    name: slug,
    workflow: resolvedWorkflow,
    approved_at: new Date().toISOString(),
    source_project: basename(root),
    destination: prefValue(prefs, "destination"),
    aspect: prefValue(prefs, "aspect"),
    language: prefValue(prefs, "language"),
    voice: prefValue(prefs, "voice"),
    // The bare-key fallback tolerates records made before the store required
    // style_preset to be workflow-scoped.
    style_preset:
      prefValue(prefs, `style_preset.${resolvedWorkflow}`) ?? prefValue(prefs, "style_preset"),
    blocks: Array.isArray(blocks) && blocks.length > 0 ? blocks : undefined,
  };

  writeFileSync(join(dir, "recipe.json"), `${JSON.stringify(recipe, null, 2)}\n`);
  cpSync(frameSpec, join(dir, "frame.md"));
  writeFileSync(
    join(dir, "storyboard-skeleton.md"),
    `${skeletonizeStoryboard(readFileSync(storyboard, "utf8")).trimEnd()}\n`,
  );

  // Best-effort fourth artifact — projects briefed before BRIEF.md existed
  // (or by workflows that don't write one) freeze fine without it.
  const brief = join(root, "BRIEF.md");
  const briefSkeleton = existsSync(brief);
  if (briefSkeleton) {
    writeFileSync(
      join(dir, "brief-skeleton.md"),
      `${skeletonizeBrief(readFileSync(brief, "utf8")).trimEnd()}\n`,
    );
  }

  const id = nextId(root, "recipe");
  appendRecord(root, {
    id,
    type: "recipe",
    path: `.media/recipes/${slug}/recipe.json`,
    entity: slug,
    description: `recipe: ${slug} (${recipe.workflow}, v${version})`,
    provenance: { provider: "recipe.freeze", version, source_project: recipe.source_project },
  });
  regenerateIndex(root);

  // User tier — best-effort, like every other promotion.
  try {
    const userDir = join(userRecipesDir(), slug);
    mkdirSync(userDir, { recursive: true });
    cpSync(dir, userDir, { recursive: true, force: true });
  } catch {
    // The project-tier freeze already landed.
  }

  return {
    id,
    slug,
    version,
    dir,
    briefSkeleton,
    workflow: resolvedWorkflow,
    workflowOverridden: Boolean(fromBrief && fromFlag && fromBrief !== fromFlag),
  };
}

function scanRecipesDir(dir, source) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.includes("@v")) continue;
    const recipe = readRecipeJson(join(dir, entry.name));
    if (recipe) found.push({ ...recipe, source, dir: join(dir, entry.name) });
  }
  return found;
}

/** Two-tier merged listing (project wins), newest approval first. */
export function listRecipes({ projectDir, workflow }) {
  const merged = new Map();
  for (const recipe of scanRecipesDir(userRecipesDir(), "user")) merged.set(recipe.name, recipe);
  for (const recipe of scanRecipesDir(projectRecipesDir(resolve(projectDir)), "project")) {
    merged.set(recipe.name, recipe);
  }
  let list = [...merged.values()];
  if (workflow) list = list.filter((r) => r.workflow === workflow);
  return list.sort((a, b) =>
    String(b.approved_at ?? "").localeCompare(String(a.approved_at ?? "")),
  );
}

/**
 * Adopt a recipe into the current project: import the folder from the user
 * tier when the project doesn't have it, copy its frame.md over the project's,
 * and hand back the values + the skeleton path for the storyboard draft.
 */
export function useRecipe({ projectDir, name }) {
  const slug = slugifyRecipeName(name);
  const root = resolve(projectDir);
  let dir = join(projectRecipesDir(root), slug);

  if (!readRecipeJson(dir)) {
    const userDir = join(userRecipesDir(), slug);
    if (!readRecipeJson(userDir)) {
      const known = listRecipes({ projectDir: root }).map((r) => r.name);
      throw new Error(
        `no recipe named "${slug}"${known.length ? ` (known: ${known.join(", ")})` : ""}`,
      );
    }
    mkdirSync(dir, { recursive: true });
    cpSync(userDir, dir, { recursive: true, force: true });
    const imported = readRecipeJson(dir);
    appendRecord(root, {
      id: nextId(root, "recipe"),
      type: "recipe",
      path: `.media/recipes/${slug}/recipe.json`,
      entity: slug,
      description: `recipe: ${slug} (${imported.workflow}, v${imported.version})`,
      provenance: { provider: "recipe.local", imported_from: "user-tier" },
    });
    regenerateIndex(root);
  }

  const recipe = readRecipeJson(dir);
  cpSync(join(dir, "frame.md"), join(root, "frame.md"));
  return {
    recipe,
    dir,
    frameSpecPath: "frame.md",
    skeletonPath: `.media/recipes/${slug}/storyboard-skeleton.md`,
    // Recipes frozen before BRIEF.md existed have no brief skeleton — degrade.
    briefSkeletonPath: existsSync(join(dir, "brief-skeleton.md"))
      ? `.media/recipes/${slug}/brief-skeleton.md`
      : undefined,
  };
}
