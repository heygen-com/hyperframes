# Skill System Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove custom skill installation from the hyperframes CLI, delegate to vercel-labs/skills, front-load SKILL.md trigger words, and clean up stale project-level skill copies.

**Architecture:** Delete `install-skills.ts` entirely. Strip skill installation logic from `init.ts` (the `installSkills` function, `getBundledSkillsDir`, project-level skill copy, `--skip-skills` flag). Replace with a post-scaffold message pointing users to `npx skills add`. Rewrite all 5 SKILL.md frontmatter descriptions to front-load trigger words within ~150 chars.

**Tech Stack:** TypeScript (citty CLI framework), Markdown (SKILL.md frontmatter)

---

### Task 1: Delete install-skills.ts and remove skills subcommand

**Files:**
- Delete: `packages/cli/src/commands/install-skills.ts`
- Modify: `packages/cli/src/cli.ts:34`

- [ ] **Step 1: Delete install-skills.ts**

```bash
rm packages/cli/src/commands/install-skills.ts
```

- [ ] **Step 2: Remove skills subcommand from cli.ts**

In `packages/cli/src/cli.ts`, remove line 34:

```typescript
// DELETE this line:
  skills: () => import("./commands/install-skills.js").then((m) => m.default),
```

The `subCommands` object (lines 25-41) should go from:

```typescript
const subCommands = {
  init: () => import("./commands/init.js").then((m) => m.default),
  preview: () => import("./commands/preview.js").then((m) => m.default),
  render: () => import("./commands/render.js").then((m) => m.default),
  lint: () => import("./commands/lint.js").then((m) => m.default),
  info: () => import("./commands/info.js").then((m) => m.default),
  compositions: () => import("./commands/compositions.js").then((m) => m.default),
  benchmark: () => import("./commands/benchmark.js").then((m) => m.default),
  browser: () => import("./commands/browser.js").then((m) => m.default),
  skills: () => import("./commands/install-skills.js").then((m) => m.default),
  transcribe: () => import("./commands/transcribe.js").then((m) => m.default),
  docs: () => import("./commands/docs.js").then((m) => m.default),
  doctor: () => import("./commands/doctor.js").then((m) => m.default),
  upgrade: () => import("./commands/upgrade.js").then((m) => m.default),
  telemetry: () => import("./commands/telemetry.js").then((m) => m.default),
  validate: () => import("./commands/validate.js").then((m) => m.default),
};
```

To:

```typescript
const subCommands = {
  init: () => import("./commands/init.js").then((m) => m.default),
  preview: () => import("./commands/preview.js").then((m) => m.default),
  render: () => import("./commands/render.js").then((m) => m.default),
  lint: () => import("./commands/lint.js").then((m) => m.default),
  info: () => import("./commands/info.js").then((m) => m.default),
  compositions: () => import("./commands/compositions.js").then((m) => m.default),
  benchmark: () => import("./commands/benchmark.js").then((m) => m.default),
  browser: () => import("./commands/browser.js").then((m) => m.default),
  transcribe: () => import("./commands/transcribe.js").then((m) => m.default),
  docs: () => import("./commands/docs.js").then((m) => m.default),
  doctor: () => import("./commands/doctor.js").then((m) => m.default),
  upgrade: () => import("./commands/upgrade.js").then((m) => m.default),
  telemetry: () => import("./commands/telemetry.js").then((m) => m.default),
  validate: () => import("./commands/validate.js").then((m) => m.default),
};
```

- [ ] **Step 3: Verify build**

```bash
cd packages/cli && pnpm build
```

Expected: builds without errors. No other file imports `install-skills.ts` except `init.ts` (handled in Task 2).

- [ ] **Step 4: Commit**

```bash
git add -u packages/cli/src/commands/install-skills.ts packages/cli/src/cli.ts
git commit -m "refactor(cli): remove skills subcommand and install-skills module"
```

---

### Task 2: Strip skill installation from init.ts

**Files:**
- Modify: `packages/cli/src/commands/init.ts`

This task removes 4 things:
1. The `installSkills()` helper function (lines 27-88)
2. The `getBundledSkillsDir()` helper (lines 221-225)
3. The project-level skill copy block inside `scaffoldProject()` (lines 409-421)
4. The `--skip-skills` flag and all call sites
5. The "AI skills are installed" messages

And replaces them with a post-scaffold message pointing to `npx skills add`.

- [ ] **Step 1: Remove the installSkills function**

Delete the entire block from line 26 through line 88:

```typescript
// DELETE: lines 26-88
// ---------------------------------------------------------------------------
// Install skills silently after scaffolding
// ---------------------------------------------------------------------------

async function installSkills(interactive: boolean): Promise<void> {
  // ... entire function ...
}
```

- [ ] **Step 2: Remove getBundledSkillsDir**

Delete lines 221-225:

```typescript
// DELETE:
function getBundledSkillsDir(): string {
  // In dev: cli/src/commands/ → repo root skills/
  // In built: cli/dist/ → cli/dist/skills/
  return resolveAssetDir(["..", "..", "..", "..", "skills"], ["skills"]);
}
```

- [ ] **Step 3: Remove project-level skill copy from scaffoldProject**

Delete lines 409-421 inside `scaffoldProject()`:

```typescript
// DELETE:
  // Copy project-level skills (.claude/skills/) for immediate availability
  const skillsSrcDir = getBundledSkillsDir();
  if (existsSync(skillsSrcDir)) {
    const projectSkills = ["hyperframes-compose", "hyperframes-captions", "hyperframes-cli"];
    for (const skill of projectSkills) {
      const src = join(skillsSrcDir, skill);
      if (existsSync(src)) {
        const dest = resolve(destDir, ".claude", "skills", skill);
        mkdirSync(dest, { recursive: true });
        cpSync(src, dest, { recursive: true });
      }
    }
  }
```

- [ ] **Step 4: Remove --skip-skills flag and call sites**

In the `args` object, delete:

```typescript
// DELETE from args:
    "skip-skills": {
      type: "boolean",
      description: "Skip AI coding skills installation",
    },
```

In the non-interactive branch, delete:

```typescript
// DELETE:
    const skipSkills = args["skip-skills"] === true;
```

```typescript
// DELETE (non-interactive, around line 587-590):
    // Skills
    if (!skipSkills) {
      await installSkills(false);
    }
```

In the interactive branch, delete:

```typescript
// DELETE (interactive, around line 783-786):
    // 5. Install AI coding skills
    if (!skipSkills) {
      await installSkills(true);
    }
```

- [ ] **Step 5: Replace "AI skills installed" messages with npx skills add hint**

In the **non-interactive** branch (around line 599-605), replace the skill-related messaging:

```typescript
// REPLACE these lines:
      console.log(`  ${c.accent("1.")} Open this project with your AI coding agent:`);
      console.log(
        `     ${c.accent(`cd ${name}`)} then start ${c.accent("Claude Code")}, ${c.accent("Cursor")}, or your preferred agent`,
      );
      console.log(
        `     ${c.dim("AI skills are installed — your agent knows how to create and edit compositions.")}`,
      );
```

With:

```typescript
      console.log(`  ${c.accent("1.")} Install AI coding skills (one-time):`);
      console.log(`     ${c.accent("npx skills add heygen-com/hyperframes")}`);
      console.log();
      console.log(`  ${c.accent("2.")} Open this project with your AI coding agent:`);
      console.log(
        `     ${c.accent(`cd ${name}`)} then start ${c.accent("Claude Code")}, ${c.accent("Cursor")}, or your preferred agent`,
      );
```

And renumber the remaining steps (preview → 3, render → 4).

In the **interactive** branch (around line 791-794), replace:

```typescript
// REPLACE:
    clack.log.message(
      `${c.dim("Tip:")} Open this project with ${c.accent("Claude Code")}, ${c.accent("Cursor")}, or your preferred AI agent.\n` +
        `${c.dim("     AI skills are installed — your agent knows how to create and edit compositions.")}`,
    );
```

With:

```typescript
    clack.log.message(
      `${c.dim("Tip:")} Install AI coding skills: ${c.accent("npx skills add heygen-com/hyperframes")}\n` +
        `${c.dim("     Then open this project with")} ${c.accent("Claude Code")}${c.dim(",")} ${c.accent("Cursor")}${c.dim(", or your preferred agent.")}`,
    );
```

- [ ] **Step 6: Clean up unused imports**

Remove `cpSync` from the `node:fs` import if no longer used (check — `scaffoldProject` still uses `cpSync` for template copy, so keep it).

Remove the import of `installAllSkills` and `TARGETS` — these were only used inside `installSkills()` which is now deleted, and loaded via dynamic `import()`, so there's nothing to remove from top-level imports.

- [ ] **Step 7: Verify build**

```bash
cd packages/cli && pnpm build
```

Expected: builds without errors.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/commands/init.ts
git commit -m "refactor(init): replace skill installation with npx skills add hint"
```

---

### Task 3: Front-load SKILL.md trigger words

**Files:**
- Modify: `skills/hyperframes-compose/SKILL.md` (frontmatter only)
- Modify: `skills/hyperframes-captions/SKILL.md` (frontmatter only)
- Modify: `skills/hyperframes-cli/SKILL.md` (frontmatter only)
- Modify: `skills/gsap-effects/SKILL.md` (frontmatter only)
- Modify: `skills/audio-reactive/SKILL.md` (frontmatter only)

Only the `description` (and `trigger` where present) fields change. No body content changes.

- [ ] **Step 1: Update hyperframes-compose description**

In `skills/hyperframes-compose/SKILL.md`, replace the frontmatter:

```yaml
---
name: hyperframes-compose
description: Create HyperFrames HTML video compositions. Use when asked to create a video, build an animation, make a composition, add a title card, or generate any HTML-based video content for HyperFrames.
---
```

With:

```yaml
---
name: hyperframes-compose
description: Create video compositions, animations, title cards, or overlays in HyperFrames HTML. Use when asked to build any HTML-based video content.
---
```

- [ ] **Step 2: Update hyperframes-captions description**

In `skills/hyperframes-captions/SKILL.md`, replace the frontmatter:

```yaml
---
name: hyperframes-captions
description: Build tone-adaptive captions from whisper transcripts. Detects script energy (hype, corporate, tutorial, storytelling, social) and applies matching typography, color, and animation. Supports per-word styling for brand names, ALL CAPS, numbers, and CTAs. Use when adding captions, subtitles, or lyrics to a HyperFrames composition. Lyric videos ARE captions — any text synced to audio uses this skill.
trigger: Use this skill whenever a task involves syncing text to audio timing. This includes captions, subtitles, lyrics, karaoke, transcription overlays, and any word-level or phrase-level text timed to speech or music.
---
```

With:

```yaml
---
name: hyperframes-captions
description: Captions, subtitles, lyrics, and karaoke synced to audio in HyperFrames. Tone-adaptive — detects script energy and applies matching typography, color, and animation with per-word styling.
trigger: Syncing text to audio timing — captions, subtitles, lyrics, karaoke, transcription overlays, word-level or phrase-level text timed to speech or music.
---
```

- [ ] **Step 3: Update hyperframes-cli description**

In `skills/hyperframes-cli/SKILL.md`, replace the frontmatter:

```yaml
---
name: hyperframes-cli
description: Use when the user mentions "hyperframes", wants to preview a composition in the studio, render to MP4/WebM, scaffold a new video project, lint or validate a composition, or troubleshoot rendering. Also use after finishing a composition with compose-video — lint and preview are the natural next steps.
---
```

With:

```yaml
---
name: hyperframes-cli
description: Preview, render, lint, validate, scaffold, or troubleshoot HyperFrames compositions. Also use after finishing a composition — lint and preview are the natural next steps.
---
```

- [ ] **Step 4: Update gsap-effects description**

In `skills/gsap-effects/SKILL.md`, replace the frontmatter:

```yaml
---
name: gsap-effects
description: Ready-made animation effects for HyperFrames compositions. Use when adding typewriter text, text reveals, character-by-character animation, audio visualizations, spectrum bars, waveform displays, or any reactive audio-driven animation to a composition. Also use when audio has been analyzed or transcribed in the current session and music is detected — the audio visualizer can enhance the composition with reactive visuals. Reference files contain patterns and data contracts.
---
```

With:

```yaml
---
name: gsap-effects
description: Typewriter text, audio visualizer, and drop-in animation effects for HyperFrames compositions. Use for character-by-character reveals, spectrum bars, waveforms, or audio-reactive visuals.
---
```

- [ ] **Step 5: Update audio-reactive description**

In `skills/audio-reactive/SKILL.md`, replace the frontmatter:

```yaml
---
name: audio-reactive
description: Drive any visual element in a HyperFrames composition from audio data — captions, backgrounds, shapes, overlays, anything GSAP can animate. Use when a composition should respond to music, voice, or sound.
trigger: Use when a composition involves music, beat-synced animation, audio visualization, or any visual element that should react to sound.
---
```

With:

```yaml
---
name: audio-reactive
description: Audio-reactive animation — drive visuals from music, voice, or sound in HyperFrames. Maps frequency bands and amplitude to any GSAP-animatable property.
trigger: Use when a composition involves music, beat-synced animation, audio visualization, or any visual reacting to sound.
---
```

- [ ] **Step 6: Commit**

```bash
git add skills/*/SKILL.md
git commit -m "refactor(skills): front-load trigger words in SKILL.md descriptions"
```

---

### Task 4: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace the "Installing skills" section**

In `CLAUDE.md`, find the current installing skills section (lines ~39-49):

```markdown
### Installing skills

```bash
npx hyperframes skills            # install to Claude, Gemini, Codex (global)
npx hyperframes skills --claude   # Claude Code only
npx hyperframes skills --windsurf # Windsurf (project-level)
npx hyperframes skills --cursor --cline --roo --trae  # multiple project targets
npx skills add greensock/gsap-skills  # alternative: via skills CLI
```

Supported targets: Claude Code, Gemini CLI, Codex CLI (global, enabled by default), Cursor, Windsurf, Cline, Roo Code, Trae (project-level, opt-in via flag).
```

Replace with:

```markdown
### Installing skills

```bash
npx skills add heygen-com/hyperframes   # HyperFrames skills
npx skills add greensock/gsap-skills     # GSAP skills
```

Uses [vercel-labs/skills](https://github.com/vercel-labs/skills). Installs to Claude Code, Gemini CLI, and Codex CLI by default. Pass `-a <agent>` for other targets.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md skill install instructions to use vercel-labs/skills"
```

---

### Task 5: Clean up my-video/.claude/skills/

**Files:**
- Delete: `my-video/.claude/skills/compose-video/` (legacy name)
- Delete: `my-video/.claude/skills/captions/` (legacy name)
- Delete: `my-video/.claude/skills/hyperframes-compose/` (stale project copy)
- Delete: `my-video/.claude/skills/hyperframes-captions/` (stale project copy)
- Delete: `my-video/.claude/skills/hyperframes-cli/` (stale project copy)

- [ ] **Step 1: Remove all project-level skill directories**

```bash
rm -rf my-video/.claude/skills/compose-video
rm -rf my-video/.claude/skills/captions
rm -rf my-video/.claude/skills/hyperframes-compose
rm -rf my-video/.claude/skills/hyperframes-captions
rm -rf my-video/.claude/skills/hyperframes-cli
```

This removes the entire `my-video/.claude/skills/` directory contents. If the directory is now empty, remove it too:

```bash
rmdir my-video/.claude/skills 2>/dev/null
rmdir my-video/.claude 2>/dev/null
```

(These will fail silently if the dirs contain other files, which is fine.)

- [ ] **Step 2: Commit**

```bash
git add -u my-video/.claude/
git commit -m "chore: remove stale and legacy project-level skill copies"
```

---

### Task 6: Final verification

- [ ] **Step 1: Build the CLI**

```bash
pnpm build
```

Expected: all packages build without errors.

- [ ] **Step 2: Verify `hyperframes skills` is gone**

```bash
npx tsx packages/cli/src/cli.ts skills
```

Expected: error — unknown command.

- [ ] **Step 3: Verify init still works (non-interactive)**

```bash
npx tsx packages/cli/src/cli.ts init test-cleanup --template blank --non-interactive --skip-transcribe
```

Expected: scaffolds successfully, prints `npx skills add heygen-com/hyperframes` in post-scaffold message, no skill installation attempted.

- [ ] **Step 4: Clean up test output**

```bash
rm -rf test-cleanup
```

- [ ] **Step 5: Verify no remaining references to install-skills**

```bash
grep -r "install-skills" packages/cli/src/ --include="*.ts"
```

Expected: no results.
