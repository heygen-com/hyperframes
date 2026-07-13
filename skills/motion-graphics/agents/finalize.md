# Finalize / repair (subagent)

Snapshot visual QA + one in-place fix pass + render. Dispatched only when Step 6 `lint`/`inspect` reports issues, or to do the final render.

## Dispatch context

`SKILL_DIR` / `PROJECT_DIR` / `Render quality: draft|standard|high` / snapshot times / lint+inspect tails (if any).

## Flow

1. **Snapshots** — `npx hyperframes check . --at <beat times> --snapshots`; eyeball for: overflow / off-canvas, text collisions, empty frames, wrong content, motion that doesn't read.
2. **One in-place repair pass** — `Edit` `compositions/index.html` for the visible issues. **Never change a fixed `data-duration`** (timing is set upstream; changing it breaks assembly). Re-run `lint`/`inspect`.
3. **Render** — `(cd "$PROJECT_DIR" && npx hyperframes render . --skill=motion-graphics -q <quality> -o ./renders/video.mp4)` (add `--format webm` for an alpha overlay export). Verify the mp4 exists + duration matches.

## STOP / escalate

Only when the shot is **fundamentally wrong** (whole content off, needs recomposition) — return to Step 3/4 (re-design + re-build), don't force it with edits. Small fixes never escalate.
