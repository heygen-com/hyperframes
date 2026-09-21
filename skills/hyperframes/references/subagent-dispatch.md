# Subagent dispatch — harness adapter

The video workflows (`product-launch-video` / `faceless-explainer` / `pr-to-video` / `motion-graphics` / `general-video`) describe subagent dispatch in harness-neutral verbs. This file maps those verbs to the primitives of whatever agent harness you are running on. Read it once per run, before the first dispatch; everything else in the workflows (dispatch packets, file artifacts, exit-code gates, Resume tables) is harness-independent and needs no translation.

## The contract (identical on every harness)

- **DISPATCH(role_file, dispatch_context)** — start one child agent whose prompt is the **full contents of the named role file** (a builder-assembled payload like `.hyperframes/frame-packets/_role.md`, or a workflow's `sub-agents/<role>.md`) followed by the `## Dispatch context` block from the workflow, copied **verbatim** (never digested or paraphrased). Every harness below accepts arbitrary task text, so this works everywhere; never rely on the child seeing your conversation, memory, or skills — the prompt and the files on disk are its entire world.
- **Parallel fan-out** — when a step says "start N workers in parallel", the workers are mutually independent (no ordering, no shared state beyond the filesystem). Run as many concurrently as your harness allows.
- **WAIT** — a step's completion criterion is always **the expected artifact existing on disk** (e.g. `compositions/<scene-id>.html`), never the harness's completion notification (some harnesses deliver results best-effort). After waiting, verify the artifacts; a missing artifact means that child failed — re-dispatch it once with the same prompt before surfacing an error.

## Concurrency cap → batching rule (cap never changes scope)

A harness concurrency limit **reduces parallelism, not work**: every scene still gets built, one scene per dispatch, with the available slots chewing through the full list.

- When the harness queues excess children internally, submit **all N at once** and let the queue drain.
- Harness hard-caps active children (e.g. OpenClaw `maxChildrenPerAgent`) → dispatch in **waves of the cap size**: start `cap` workers, wait for their artifacts, start the next wave, until all N scenes exist. Example: 9 scenes on a cap-3 harness = 3 waves of 3 — never drop scenes, never merge scenes into one worker to fit the cap.

## Harness mapping

Use the current harness's native delegation and waiting tools when they are available. The workflow contract stays the same:

- **DISPATCH** sends the complete role file and dispatch context to one worker.
- **Parallel fan-out** starts independent workers concurrently up to the harness limit.
- **WAIT** verifies the expected artifacts on disk, not only a completion notification.
- **Re-dispatch** starts a fresh worker with the same context plus the gate failure.

When native delegation is unavailable, use the existing fallback ladder: launch headless CLI workers that share the project filesystem, then fall back to inline serial execution.

On Codex, native delegation requires the user's explicit permission. Fold a one-line request into the workflow's first existing user pause before dispatch; a standing grant in `AGENTS.md` or the kickoff prompt also counts. Without it, use the fallback ladder rather than silently skipping work.

## Vocabulary mapping

- A request to work "in the background" means dispatch concurrently when the harness supports it.
- Load a named skill through the harness's skill mechanism, or read `<skills-root>/<skill>/SKILL.md` directly.
- Map generic read, write, edit, and shell verbs to the current harness's equivalent tools.
