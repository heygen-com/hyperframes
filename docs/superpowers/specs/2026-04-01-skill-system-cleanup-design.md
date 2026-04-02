# Skill System Cleanup

**Date:** 2026-04-01
**Branch:** `vance/skill-system-cleanup` (from `feature/caption-designer`)

## Problem

The hyperframes skill system has operational issues identified by reviewing against agentic harness patterns:

1. **Staleness** — `init` copies skills to project `.claude/skills/` at scaffold time. These snapshots diverge from source immediately with no sync mechanism.
2. **Deduplication** — Legacy skill names (`compose-video`, `captions`) coexist with current names (`hyperframes-compose`, `hyperframes-captions`) in project dirs.
3. **Listing budget** — SKILL.md descriptions bury trigger words at the end; Claude Code truncates long descriptions.
4. **Completeness** — Only 3 of 5 skills copied to project level; `audio-reactive` and `gsap-effects` missing.
5. **Unnecessary code** — `install-skills.ts` (380 lines) is a thin wrapper around `npx skills add` with a git fallback. The upstream [vercel-labs/skills](https://github.com/vercel-labs/skills) CLI handles this better.

## Solution

Remove all skill installation code from the hyperframes CLI. Delegate to `npx skills add` from vercel-labs/skills. This eliminates categories 1, 2, and 4 entirely.

### Changes

#### 1. Delete `packages/cli/src/commands/install-skills.ts`

Remove the file. It contains:
- Multi-target installation logic (Claude, Gemini, Codex, Cursor)
- `npx skills add` wrapper + git clone fallback
- `installAllSkills()` programmatic API used by init

#### 2. Update `packages/cli/src/commands/init.ts`

- Remove `installAllSkills` import and `installSkills()` helper function
- Remove project-level skill copy logic (`getBundledSkillsDir`, the loop copying to `.claude/skills/`)
- Remove `--skip-skills` flag
- Replace with a post-scaffold message telling users to run:
  ```
  npx skills add heygen-com/hyperframes
  ```

#### 3. Update `packages/cli/src/cli.ts`

- Remove `skills` subcommand registration

#### 4. Front-load SKILL.md trigger words

Rewrite all 5 skill descriptions so activation language comes first, within ~150 chars:

| Skill | Current start | New start |
|-------|--------------|-----------|
| hyperframes-compose | "Create HyperFrames HTML video compositions..." | "Create video compositions, animations, title cards, or overlays in HyperFrames HTML." |
| hyperframes-captions | "Build tone-adaptive captions from whisper..." | "Captions, subtitles, lyrics, and karaoke synced to audio in HyperFrames." |
| hyperframes-cli | "Use when the user mentions hyperframes..." | "Preview, render, lint, scaffold, or troubleshoot HyperFrames compositions." |
| gsap-effects | "Ready-made animation effects for HyperFrames..." | "Typewriter text, audio visualizer, and drop-in animation effects for HyperFrames." |
| audio-reactive | "Drive any visual element in a HyperFrames..." | "Audio-reactive animation — drive visuals from music, voice, or sound in HyperFrames." |

#### 5. Update CLAUDE.md

Replace the "Installing skills" section with:

    ### Installing skills

    ```bash
    npx skills add heygen-com/hyperframes   # HyperFrames skills
    npx skills add greensock/gsap-skills     # GSAP skills
    ```

#### 6. Clean up `my-video/.claude/skills/`

Remove legacy-named directories:
- `my-video/.claude/skills/compose-video/`
- `my-video/.claude/skills/captions/`

And remove the now-unnecessary current copies (global install is sufficient):
- `my-video/.claude/skills/hyperframes-compose/`
- `my-video/.claude/skills/hyperframes-captions/`
- `my-video/.claude/skills/hyperframes-cli/`

## Out of Scope

- Skill versioning (`requires` frontmatter field) — separate follow-up
- Changes to skill content/behavior — only frontmatter descriptions change
- Changes to the skills themselves (patterns.md, dynamic-techniques.md, etc.)
