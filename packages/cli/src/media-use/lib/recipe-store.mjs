import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { globalMediaDir } from "./media-home.mjs";
import { appendRecord, mediaDir, nextId, refuseLink, replaceFile } from "./manifest.mjs";
import { regenerateIndex } from "./index-gen.mjs";
import { mergedPreferences } from "./prefs-store.mjs";

/** The files a recipe folder holds. Nothing else in a recipe folder is copied between tiers. */
const RECIPE_FILES = ["recipe.json", "frame.md", "storyboard-skeleton.md", "brief-skeleton.md"];

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
 * a recipe never locks the run's shape, so these are always asked again. */
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
  return join(globalMediaDir(), "recipes");
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

/** The run's workflow as BRIEF.md's text records it — the source of truth a freeze
 * must not contradict. Undefined when there is no BRIEF.md (or no `workflow:`). */
function briefWorkflow(brief) {
  if (brief === undefined) return undefined;
  const lines = brief.split(/\r?\n/);
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

/** The highest `<slug>@v<N>` archive number in `recipesDir`, 0 when there is none. */
function highestArchive(recipesDir, slug) {
  const prefix = `${slug}@v`;
  let highest = 0;
  for (const entry of readdirSync(recipesDir)) {
    if (!entry.startsWith(prefix)) continue;
    const number = Number(entry.slice(prefix.length));
    if (Number.isSafeInteger(number) && number > highest) highest = number;
  }
  return highest;
}

function prefValue(prefs, key) {
  return prefs[key]?.value;
}

/**
 * Throws, before anything is moved or written, when `.media`, `.media/recipes` or the recipe's own
 * folder is a link. A project from someone else could carry such a link to send recipe writes
 * outside the project.
 */
function refuseLinkedRecipeDir(root, slug) {
  for (const path of [
    mediaDir(root),
    projectRecipesDir(root),
    join(projectRecipesDir(root), slug),
  ]) {
    refuseLink(path);
  }
}

/**
 * The content of the regular file at `path`, or undefined when it is missing, a link or not a file.
 * After the open, `path` must still be a regular file with the device and inode the handle has. A
 * link has its own inode, so it never matches the file an open reached through it, even where Node
 * has no `O_NOFOLLOW` (Windows); pass 0 as `noFollow` to check that path. `O_NONBLOCK` keeps a FIFO
 * from blocking the open.
 */
export function readRegularFile(path, noFollow = constants.O_NOFOLLOW ?? 0) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | noFollow | (constants.O_NONBLOCK ?? 0));
  } catch {
    return undefined;
  }
  try {
    const opened = fstatSync(fd, { bigint: true });
    const atPath = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    const same =
      opened.isFile() && atPath?.isFile() && opened.dev === atPath.dev && opened.ino === atPath.ino;
    return same ? readFileSync(fd) : undefined;
  } finally {
    closeSync(fd);
  }
}

/**
 * Writes each named file into `dir` as a new regular file, replacing a link at that name instead
 * of following it, and removes a leftover brief skeleton the bundle does not have.
 */
/**
 * The content of the project's own `name`, or undefined when it is missing. Throws when it is a link
 * or not a regular file, since a received project could link it to a file outside the project.
 */
function readProjectSource(root, name) {
  const path = join(root, name);
  const content = readRegularFile(path);
  if (content === undefined && lstatSync(path, { throwIfNoEntry: false })) {
    throw new Error(`${path} is a link or not a regular file; nothing was frozen`);
  }
  return content;
}

function writeRecipeFiles(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) replaceFile(join(dir, name), content);
  if (!("brief-skeleton.md" in files)) rmSync(join(dir, "brief-skeleton.md"), { force: true });
}

/**
 * Freeze the current project's approved run as a named recipe. Writes the
 * project-tier folder + a manifest record, then copies to the user tier (a
 * freeze is already confirmed — it promotes immediately).
 */
export function freezeRecipe({ projectDir, name, workflow, blocks }) {
  const slug = slugifyRecipeName(name);
  const root = resolve(projectDir);
  // Read before anything moves, so a source that is a link stops the freeze with nothing written.
  const frame = readProjectSource(root, "frame.md");
  const storyboard = readProjectSource(root, "STORYBOARD.md")?.toString("utf8");
  const brief = readProjectSource(root, "BRIEF.md")?.toString("utf8");
  const fromBrief = briefWorkflow(brief);
  const fromFlag = workflow && String(workflow).trim() ? String(workflow).trim() : undefined;
  // BRIEF.md decides; the flag only covers projects briefed before it existed.
  const resolvedWorkflow = fromBrief ?? fromFlag;
  if (!resolvedWorkflow) {
    throw new Error("no workflow found — BRIEF.md names none and no --workflow was given");
  }
  if (frame === undefined) throw new Error("no frame.md to freeze — run the design step first");
  if (storyboard === undefined) throw new Error("no STORYBOARD.md to freeze");

  refuseLinkedRecipeDir(root, slug);
  const dir = join(projectRecipesDir(root), slug);
  let version = 1;
  const previous = existsSync(dir) ? readRecipeJson(dir) : null;
  if (previous) {
    // recipe.json travels with the project, so its version is untrusted text: only a positive
    // integer may name the archive, and an archive already on disk is never replaced. A
    // malformed version, or one whose archive exists, moves to the first slot above them all.
    const claimed =
      Number.isSafeInteger(previous.version) && previous.version > 0 ? previous.version : 0;
    const slot =
      claimed && !existsSync(`${dir}@v${claimed}`)
        ? claimed
        : Math.max(claimed, highestArchive(projectRecipesDir(root), slug)) + 1;
    version = slot + 1;
    // Checked before either folder moves, and keeps the next freeze's version valid too.
    if (!Number.isSafeInteger(version)) {
      throw new Error(`recipe "${slug}" has no version number left to freeze into`);
    }
    renameSync(dir, `${dir}@v${slot}`);
  }

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

  const files = {
    "recipe.json": `${JSON.stringify(recipe, null, 2)}\n`,
    "frame.md": frame,
    "storyboard-skeleton.md": `${skeletonizeStoryboard(storyboard).trimEnd()}\n`,
  };
  // Best-effort fourth artifact — projects briefed before BRIEF.md existed
  // (or by workflows that don't write one) freeze fine without it.
  const briefSkeleton = brief !== undefined;
  if (briefSkeleton) {
    files["brief-skeleton.md"] = `${skeletonizeBrief(brief).trimEnd()}\n`;
  }
  writeRecipeFiles(dir, files);

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

  // User tier — best-effort, like every other promotion. Only the files this freeze wrote go there.
  try {
    writeRecipeFiles(join(userRecipesDir(), slug), files);
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
  refuseLinkedRecipeDir(root, slug);
  const dir = join(projectRecipesDir(root), slug);

  if (!readRecipeJson(dir)) {
    const userDir = join(userRecipesDir(), slug);
    if (!readRecipeJson(userDir)) {
      const known = listRecipes({ projectDir: root }).map((r) => r.name);
      throw new Error(
        `no recipe named "${slug}"${known.length ? ` (known: ${known.join(", ")})` : ""}`,
      );
    }
    // Only regular recipe files come over; a link or anything else in the user-tier folder stays there.
    const files = {};
    for (const file of RECIPE_FILES) {
      const content = readRegularFile(join(userDir, file));
      if (content !== undefined) files[file] = content;
    }
    if (!files["recipe.json"]) {
      throw new Error(
        `${join(userDir, "recipe.json")} is not a regular file; nothing was imported`,
      );
    }
    writeRecipeFiles(dir, files);
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
  const frameSpec = join(dir, "frame.md");
  const frame = readRegularFile(frameSpec);
  if (frame === undefined) {
    throw new Error(`${frameSpec} is missing, a link or not a regular file; nothing was read`);
  }
  replaceFile(join(root, "frame.md"), frame);
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
