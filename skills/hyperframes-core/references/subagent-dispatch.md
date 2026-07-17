# Subagent dispatch — harness adapter

The video workflows (`product-launch-video` / `faceless-explainer` / `pr-to-video` / `motion-graphics` / `general-video`) describe subagent dispatch in harness-neutral verbs. This file maps those verbs to the primitives of whatever agent harness you are running on. Read it once per run, before the first dispatch; everything else in the workflows (dispatch packets, file artifacts, exit-code gates, Resume tables) is harness-independent and needs no translation.

## The contract (identical on every harness)

- **DISPATCH(role_file, dispatch_context)** — start one child agent whose prompt is the **full contents of the named role file** (a builder-assembled payload like `.hyperframes/frame-packets/_role.md`, or a workflow's `sub-agents/<role>.md`) followed by the `## Dispatch context` block from the workflow, copied **verbatim** (never digested or paraphrased). Every harness below accepts arbitrary task text, so this works everywhere; never rely on the child seeing your conversation, memory, or skills — the prompt and the files on disk are its entire world.
- **Parallel fan-out** — when a step says "start N workers in parallel", the workers are mutually independent (no ordering, no shared state beyond the filesystem). Run as many concurrently as your harness allows.
- **WAIT** — a step's completion criterion is always **the expected artifact existing on disk** (e.g. `compositions/<scene-id>.html`), never the harness's completion notification (some harnesses deliver results best-effort). After waiting, verify the artifacts; a missing artifact means that child failed — re-dispatch it once with the same prompt before surfacing an error.

## Concurrency cap → batching rule (cap never changes scope)

A harness concurrency limit **reduces parallelism, not work**: every scene still gets built, one scene per dispatch, with the available slots chewing through the full list.

- Harness queues excess children internally (Claude Code; Hermes `delegate_task` beyond `max_concurrent_children`) → submit **all N at once** and let the queue drain.
- Harness hard-caps active children (e.g. OpenClaw `maxChildrenPerAgent`) → dispatch in **waves of the cap size**: start `cap` workers, wait for their artifacts, start the next wave, until all N scenes exist. Example: 9 scenes on a cap-3 harness = 3 waves of 3 — never drop scenes, never merge scenes into one worker to fit the cap.

## Primitive map

| Verb in the workflows            | Claude Code                                                         | Codex CLI                                                                                   | OpenClaw                                                                               | Hermes Agent                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| DISPATCH                         | `Agent` tool, `subagent_type: "general-purpose"`                    | `spawn_agent` (built-in `worker` role; prompt carries the role file)                        | `sessions_spawn` (role file rides in `task`; child only auto-loads AGENTS.md/TOOLS.md) | `delegate_task` — put role file + context into each task's `context` (child system prompt is not customizable) |
| parallel fan-out                 | multiple Agent calls in one message, each `run_in_background: true` | multiple `spawn_agent` calls (async by design) or `spawn_agents_on_csv` for uniform batches | repeated `sessions_spawn` (always non-blocking)                                        | one `delegate_task(tasks=[...])` batch call                                                                    |
| WAIT                             | background-task completion notifications arrive automatically       | `wait_agent` with all child IDs                                                             | `sessions_yield` (never poll session lists)                                            | `delegate_task` returns when all tasks finish (blocking the turn is normal)                                    |
| default concurrency              | min(16, cores − 2), excess queues                                   | 6 (`agents.max_threads`)                                                                    | 5 active per session, 8 global                                                         | 3 (`delegation.max_concurrent_children`)                                                                       |
| re-dispatch after a gate failure | new Agent call, same prompt + the error/`## Repair context`         | new `spawn_agent`, same prompt + the error                                                  | new `sessions_spawn`, same `task` + the error                                          | new `delegate_task`, same `context` + the error                                                                |

Harness-specific notes:

- **Codex**: children inherit the parent cwd and cannot change it — exactly what these pipelines need (shared `PROJECT_DIR`). Prefer prompt-carried roles over `.codex/agents/*.toml` registration; the workflows already deliver roles in the prompt. **Codex policy-gates spawning on the user explicitly requesting delegation — a skill instruction alone does not satisfy it, and you will be tempted to skip the tool without even trying.** Do not silently degrade: on Codex, if the user has not granted delegation this session, **ask one line** — "OK to run this workflow's workers as parallel subagents?" — **folded into the workflow's first existing user pause** (e.g. the API-key question) so the run pauses only once; at the latest, before the first dispatch step. An affirmative — or a standing grant in the workspace `AGENTS.md` or the kickoff prompt — unlocks native dispatch for the whole session. Only without a grant: prefer ladder rung 1 below (headless `codex exec` children) for the scene fan-out; inline serial is the last resort.
- **OpenClaw**: result announcement is best-effort (lost on gateway restart) — the artifact-on-disk WAIT rule above is the source of truth, not the announce message.
- **Hermes**: children get a fresh conversation and only see what you put in `context`, and only the final summary returns — both already match the workflows' design (dispatch packets carry everything; results land on disk). Requires a **local execution backend** (the pipelines exchange data through `PROJECT_DIR` and packet files on the shared filesystem; Docker/remote backends break that).
- **Any other harness**, or subagents unavailable/disabled — degrade down this ladder:
  1. Headless CLI children: write each child prompt to a file, start the CLI per worker as a background shell process (redirect stdin from /dev/null, output to a log), then collect artifacts from disk.
  2. Inline serial execution: do each role yourself, one at a time — read the role file, follow it with the dispatch context as if you were the child, finish, then return to the runbook. Load only one role's resources at a time (a scene's role file + its packet), and still run every per-role self-check before moving on.

## Vocabulary mapping (older phrasing you may meet in agent prompts)

- "in the same message" / `run_in_background: true` — Claude Code idioms for "concurrently / as a background child"; apply your harness's equivalent from the table.
- "Skill `X`" / "loaded with the Skill tool" — load skill X; on harnesses without a skill-loading tool, read `<skills-root>/X/SKILL.md` directly (the skills root is the directory containing this skill family; derive it from `SKILL_DIR` in your dispatch context).
- `Read` / `Write` / `Edit` / `Bash` — capability names (read file / write file / edit in place / run shell); map to your harness's tools.
