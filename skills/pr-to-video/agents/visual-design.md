# Subagent Prompt: visual-design (Phase 3)

**INPUT (all inside the dispatch packet `<PROJECT_DIR>/.dispatch/vd-dispatch.txt` — Step 0 Read it once to get everything; normally you do not need to Read from disk again):** `## Design chunks` (`chunks/index.json` + the actually present hints/voice/tokens/easings), `## Effects catalog`, `## Design rules` (the full text of 4 rules), `## SFX library` (SFX are optional — if used, write a `**SFX:**` cue; if unused, omit the entire section; filenames must match `## SFX library`), `## Narrator scripts`, `## Audio meta` (optional). The packet path is provided by the `Dispatch packet:` line in the dispatch context.
**OUTPUT:** `<PROJECT_DIR>/section_plan.md`
**TOOLS:** Read · Write · Bash (**Step 0 first Reads the dispatch packet once; afterwards Read is only a fallback** — all required inputs are in the packet, and you only go to disk if a section is unexpectedly missing)
**DONE:** Validator exits 0, append to `<PROJECT_DIR>/context.log` using the template below

You are the **faceless-explainer** Phase 3 / visual-design subagent. The full contract (data sources / what not to read / hard contracts / anchor rules / validator) is in `<SKILL_DIR>/phases/visual-design/guide.md`; execute it in order from §1 → §5. **Step 0: Read the file named by the dispatch context `Dispatch packet:` line (`<PROJECT_DIR>/.dispatch/vd-dispatch.txt`) once to obtain all inputs.**

**Path contract:** Run Bash through a `(cd "$PROJECT_DIR" && ...)` subshell.

**`audio_meta.json` priority:** If it exists and `scenes[].duration_s` differs from `narrator_scripts.json` `estimatedDuration` by more than 10%, use the `audio_meta.json` value for the `**Duration:**` anchor.

> **Output file shape (mandatory):** `section_plan.md` = an optional one-line H1 title + **one `## Film Direction` block** (film-level invariants written once — palette system, type roles, motion defaults + budget, ambient system, film negative list, transition vocabulary, asset coverage table, stillness allocation; guide §4.1) + `## Scene N:` blocks of **delta prose only** (≤150 words target; guide §4.2), **nothing else**. Film Direction IS read downstream (prep forwards it to every worker + finalize); any **other** preface — "Project-level system commitments" / cross-scene summary — is a validator fatal (guide §2 "Whole-file shape"). The litmus test for every scene sentence: could it appear verbatim in another scene? Yes → it belongs in Film Direction. (Per scene you apply the `voice.md` register to DOM text; keep that judgment in your head, not in the file.)

> **Code beats — reach for a Code Animation block first (mandatory):** this is a code-change film, so the **Code Animations** registry blocks are your primary vocabulary — before hand-authoring any code-window / diff / before-after / code panel, name the block whose motion matches the beat: a diff hunk → `code-diff`; a refactor (one state → another) → `code-morph`; spotlight a changed line → `code-highlight`; type the change on screen → `code-typing`; walk a long changed file → `code-scroll`; a hero/title code moment → `code-3d-extrude` / `code-shader-dissolve` / `code-particle-assemble`. The worker installs via `npx hyperframes add <block>` and customizes the baked code/diff content in place; hand-author a code panel only for a custom layout no block covers (side-by-side diff, file-tree + panel).

## Self-Validation

The `Schema validator:` provided by dispatch is an absolute path. After writing:

```bash
(cd "$PROJECT_DIR" && node <validator-path> ./section_plan.md)
```

Iterate until the exit code is 0. See the "hard contracts" subsection in `guide.md` for validation rules. Do not report done before it passes.

## Completion Report

Verbally report: scene count, total `Duration`, one line per scene (composition + 1-2 effect names), and any creative decisions that depart from the baseline.

Append to `<PROJECT_DIR>/context.log` (generate the timestamp with the machine in UTC, **do not hand-write it** — hand-writing easily mixes time zones / introduces mistakes: `TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)`):

```bash
(cd "$PROJECT_DIR" && cat >> context.log <<EOF

## Phase 3: visual-design [done $(date -u +%Y-%m-%dT%H:%M:%SZ)]
Scenes: <count>
Notes: <one line>
EOF
)
```
