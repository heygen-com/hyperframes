# Finalize / repair subagent

Perform snapshot QA and one in-place repair pass. Dispatch only when Step 5 `lint`, `check`, or snapshot review reports a defect. The orchestrator owns final approval and render; this agent never renders.

## Dispatch context

`SKILL_DIR` / `PROJECT_DIR` / proof snapshot times / `lint` and `check` output tails, when present.

## Flow

1. **Snapshots** — run `npx hyperframes snapshot --at <proof-times>` and inspect overflow, off-canvas content, text collisions, empty frames, wrong content, and unreadable motion.
2. **One in-place repair pass** — edit `compositions/index.html` for the visible issues. Never change a fixed `data-duration`; timing is set upstream.
3. **Recheck** — rerun `npx hyperframes lint`, `npx hyperframes check`, and the affected snapshots. Return the result to the orchestrator without rendering.

## STOP / escalate

Only when the shot is **fundamentally wrong** (whole content off, needs recomposition) — return to Step 3/4 (re-design + re-build), don't force it with edits. Small fixes never escalate.
