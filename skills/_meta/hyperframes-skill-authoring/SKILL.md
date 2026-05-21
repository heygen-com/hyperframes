---
name: hyperframes-skill-authoring
description: "Write or refactor HyperFrames animation skills — rules, blueprints, and examples. Enforces a three-tier abstraction contract: rules teach atomic patterns, blueprints teach scene orchestration, examples are runnable ground truth. Concrete values (brand names, copy, colors, magic numbers, specific timings) are forbidden in rules and blueprints — they live only in examples."
metadata:
  tags: skill-authoring, rules, blueprints, examples, refactor, abstraction, hyperframes-animation
---

# HyperFrames Skill Authoring

How to write or refactor files under `skills/hyperframes-animation/{rules,blueprints,examples}/`. Each tier has a strict abstraction contract — break it and the skill stops teaching.

Currently scoped to `hyperframes-animation` (the only skill with the three-tier structure). Generalizable when other skills grow the same shape.

## Three Tiers and Their Correspondence

| Tier          | Path                   | Teaches                         | Abstraction           | Per-file count    |
| ------------- | ---------------------- | ------------------------------- | --------------------- | ----------------- |
| **rule**      | `rules/<name>.md`      | one atomic technique            | high                  | many              |
| **blueprint** | `blueprints/<name>.md` | multi-phase scene orchestration | highest               | many              |
| **example**   | `examples/<name>.html` | one runnable ground truth       | none (fully concrete) | one per blueprint |

Cross-references:

- One blueprint ↔ exactly one example, sharing the same `<name>` stem
- One blueprint references multiple rules (declared in `uses_rules:` frontmatter)
- One rule may be referenced by many blueprints
- Rules do NOT each get their own example; rules are seen in action via blueprints' examples
- `SKILL.md` indexes every blueprint, rule, and example

## Fact Conflict Priority

When the three files disagree on a fact (brand name, ease coefficient, etc.):

**examples > rules > blueprints** — fix the higher-abstraction file.

In practice this usually means: **remove the specific fact from the blueprint** (it shouldn't have been there). It rarely means changing the example.

## Abstraction Spectrum (the core contract)

| Content                                                                                                 | rules                                                 | blueprints                                            | examples          |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- | ----------------- |
| Brand / product names                                                                                   | absent or `{Brand}`                                   | `{Brand}` placeholder                                 | real              |
| Copy / text content                                                                                     | placeholder strings or `{phrase}`                     | structural description, not literal                   | real              |
| Asset paths                                                                                             | absent                                                | `{heroAsset}` placeholder                             | `assets/real.png` |
| Colors                                                                                                  | `{accentColor}` / semantic token                      | placeholder / qualitative                             | real hex          |
| Fonts                                                                                                   | `{font}` placeholder                                  | `{font}` or descriptor                                | real font stack   |
| Timing constants (phase start / dur)                                                                    | named const, **NOT assigned**; range in How to Choose | named const, **NOT assigned**; range in How to Choose | real seconds      |
| Physics params (scale ratio, ease coef, amplitude)                                                      | named const + qualitative range                       | named const + qualitative range                       | real numbers      |
| Magic number literals in code                                                                           | **forbidden** — all named constants                   | **forbidden** — all named constants                   | allowed           |
| Derived formulas (offset = …)                                                                           | full derivation kept                                  | full derivation kept                                  | concrete code     |
| Ease family choice (`back.out` vs `elastic.out` vs `power3.out`)                                        | name the family; coefficient is `{const}`             | name the family                                       | concrete          |
| Runtime contract values (CDN URL, `data-*` attrs, `window.__timelines`, `gsap.timeline({paused:true})`) | real                                                  | real                                                  | real              |

Rule of thumb: anything that is a **creative tuning choice** → abstract in rules / blueprints. Anything that is a **HF runtime contract** → concrete everywhere.

## Mandatory "How to Choose Values"

Every rule and every blueprint MUST include a `## How to Choose Values` section covering every named constant introduced in code blocks. Without it, abstract constants are uninstructable.

Template per entry:

```markdown
- **CONST_NAME** — what it controls
  - Range: <low>-<high> <unit>
  - Effects: <low end qualitative>; <high end qualitative>
  - Constraints: <hard limits, e.g. must be > prior phase end + buffer>
  - Reference: examples/<name>.html uses <value>
```

If a constant has no meaningful range (it's a discrete choice like ease family), say so explicitly and list the options with selection criteria.

## Writing a Rule

Location: `rules/<kebab-name>.md`

Frontmatter:

```yaml
---
name: <kebab-name>
description: <one line — what technique, what problem>
metadata:
  tags: <comma-separated, searchable>
---
```

Required sections (in this order):

| Section                   | Purpose                                                         |
| ------------------------- | --------------------------------------------------------------- |
| Title + one-line summary  | what technique, what it solves                                  |
| `## How It Works`         | core principle; math derivation if any                          |
| `## HTML`                 | minimal skeleton, semantic class names; NO real copy/assets     |
| `## CSS`                  | only technique-relevant rules; placeholders for colors/fonts    |
| `## GSAP Timeline`        | pattern code, named constants only, NO magic numbers            |
| `## How to Choose Values` | **mandatory**; one entry per named const                        |
| `## Variations`           | 2-4 alternative forms, one-line each                            |
| `## Key Principles`       | design rationale bullets                                        |
| `## Critical Constraints` | hard rules (timeline paused, registry, no CSS animations, etc.) |
| `## Combinations`         | links to commonly paired rules                                  |
| `## Pairs with HF skills` | which `/hyperframes-*` upstream skills this assumes             |

Avoid in rules:

- Real brand / product / company names
- Real video copy
- Decorative styling unrelated to the technique
- Two equivalent code variants without saying when to use each
- Numbered systems (`Form 1`, `Form 2`) unless defined inside the file
- Importing a magic value from an example without abstracting

## Writing a Blueprint

Location: `blueprints/<kebab-name>.md` (matches `examples/<kebab-name>.html`)

Frontmatter:

```yaml
---
id: <kebab-name>
role: <brand-reveal | social-proof | cta | comparison | demo | problem | messaging | …>
duration_seconds: [<min>, <max>]
phases: <N>
visual_arc: <one-line narrative arc>
uses_rules: [<rule-name>, …]
element_roles:
  <role-name>: <one-line description>
when_to_use:
  - <descriptive condition, not a use-case enumeration>
when_not_to_use:
  - <disqualifying condition>
triggers: [<search keywords>]
---
```

Required sections (in this order):

| Section                        | Purpose                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| Title + one-line summary       | which kind of scene                                                                |
| `## When to Use`               | descriptive conditions — NOT use-case enumeration                                  |
| `## Phase Pipeline`            | table: phase / time window / what happens / referenced rule                        |
| `## Initial Layout`            | HTML + CSS with placeholders for brand/copy/assets                                 |
| `## Phase 1` … `## Phase N`    | per phase: editorial intent (why this phase here) + pattern code with named consts |
| `## Inter-Phase State Handoff` | phase-to-phase causal / timing dependencies — THE core teaching of a blueprint     |
| `## How to Choose Values`      | **mandatory**; covers every named const                                            |
| `## Critical Constraints`      | hard rules that protect the orchestration                                          |
| `## Spring → Ease Cheatsheet`  | if applicable                                                                      |
| `## Golden Sample`             | link to `examples/<name>.html`; do NOT restate its content                         |

Avoid in blueprints:

- Real brand names in HTML (must be `{Brand}`)
- Real copy in SEQUENCE arrays — use `{w1}`, `{w2}` or describe shape ("7-stage monotonic with one pacing hold around 40% mark")
- Specific asset paths (must be `{heroAsset}`)
- Magic number literals (must be named consts)
- Restating what the example shows — the example is one click away
- New terminology not defined in rules or `SKILL.md`

## Writing an Example

Location: `examples/<kebab-name>.html` (matches `blueprints/<kebab-name>.md`)

Required structure:

- HTML5 doctype + `<meta name="viewport" content="width=1920, height=1080">`
- Top comment: 1-2 paragraphs of choreography in seconds + key teaching points being demonstrated
- GSAP CDN, pinned version: `<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>`
- Full CSS — real colors, fonts, sizes
- Root `<div>` with `data-composition-id`, `data-start`, `data-duration`, `data-width`, `data-height`
- Full `<script>` — all consts assigned to real values, timeline built synchronously
- Assets in `assets/` subdirectory (see repo `assets/` convention)

Required validation:

- Passes `npx hyperframes lint`
- Passes `npx hyperframes validate`
- Renders to video without error
- Comment terminology matches blueprint and rule wording — no isolated numbered systems

Avoid in examples:

- Placeholders (`{Brand}`, `{logo}`) — example must be runnable
- Large teaching comments — teaching belongs in the blueprint, not the example
- Techniques not introduced by the corresponding blueprint

## Refactoring Existing Files

Use this when an existing rule or blueprint violates the contract (e.g. has real brand names, magic numbers, or contradicts its example).

### Step 1 — Diagnose

```bash
cd skills/hyperframes-animation

# Real product / brand names that leaked into rules or blueprints
grep -nE "GWISpark|Hyperframes|HeyGen|OpusClip|HeygenVerse|GWI[ -]?Spark" rules/ blueprints/

# Magic number literals in rule / blueprint code blocks (likely need named consts)
grep -nE "^[[:space:]]*const [A-Z_]+ *= *[0-9]" rules/ blueprints/

# Hex colors that aren't placeholder tokens
grep -nE "#[0-9a-fA-F]{3,8}" rules/ blueprints/

# Specific font families
grep -nE "font-family|font:.*['\"][A-Z]" rules/ blueprints/

# Numbered systems not defined in the file
grep -nE "Form [12]|Pattern [12]|Variant [12]" rules/ blueprints/
```

### Step 2 — Verify example is canonical

For each blueprint at `blueprints/X.md`:

- Confirm `examples/X.html` exists
- Confirm it passes `npx hyperframes lint`
- If facts in blueprint contradict the example: **abstract the blueprint**, do not edit the example

### Step 3 — Apply tier-appropriate abstraction

| Diagnosis                                            | Fix                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| Real brand in rule HTML                              | Remove or replace with `{Brand}`                                    |
| Real brand in blueprint HTML                         | Replace with `{Brand}`                                              |
| Magic number in rule code block                      | Promote to named const; add entry to How to Choose Values           |
| Magic number in blueprint code block                 | Same as above                                                       |
| Specific timing in rule (`POP_START = 0.73`)         | Drop the assignment; document in How to Choose Values               |
| Specific ease coef (`back.out(2)`) in rule/blueprint | `back.out(${BOUNCE_FACTOR})` + How to Choose entry                  |
| Numbered system (`Form 1`) used but not defined      | Replace with descriptive name (e.g. "onUpdate multiplicative form") |
| Specific brandTextWidth value in blueprint           | Replace with formula referencing measured value                     |
| Typos (`the the`, …)                                 | Fix in place                                                        |

### Step 4 — Update `SKILL.md` index

If blueprint metadata changed (`duration_seconds`, `phases`, `uses_rules`), update the corresponding `<blueprint>` entry in `skills/hyperframes-animation/SKILL.md`. Example descriptions in `SKILL.md` describe the specific example — concrete content there is fine.

### Step 5 — Verify

Run the diagnostic greps again from Step 1 — they should now be empty against rules/ and blueprints/.

## Authoring Checklist

Before merging any rule, blueprint, or example:

```
General (all three tiers)
[ ] frontmatter complete, field names match peers in the same tier
[ ] no Math.random(), Date.now(), performance.now()
[ ] no repeat: -1
[ ] no CSS animation / transition (use GSAP timeline)
[ ] no tween of width / height / left / top (use scale / x / y)
[ ] timeline is gsap.timeline({ paused: true }) and registered to window.__timelines

Rule-specific
[ ] zero real brand / product / company names
[ ] zero magic number literals in code blocks — all named constants
[ ] colors / fonts are placeholders or semantic tokens
[ ] "How to Choose Values" section present, covers every named const
[ ] HTML / CSS minimal — no decoration unrelated to the technique

Blueprint-specific
[ ] HTML uses {Brand} / {phrase} / {heroAsset} placeholders
[ ] code blocks use named constants only — zero magic numbers
[ ] "How to Choose Values" present
[ ] "Inter-Phase State Handoff" present
[ ] links to corresponding examples/<name>.html
[ ] does NOT restate the example's specific content
[ ] uses_rules in frontmatter matches actual rule references in the body

Example-specific
[ ] passes npx hyperframes lint
[ ] passes npx hyperframes validate
[ ] renders to video
[ ] zero placeholders — all values concrete
[ ] terminology matches blueprint / rule wording
[ ] file name matches the corresponding blueprint
```

## Common Anti-Patterns

| Anti-pattern                                                          | Fix                                                               |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Rule with `const POP_DUR = 0.5`                                       | `POP_DUR` named only; range + reference value in How to Choose    |
| Blueprint with `<img src="./assets/logo.png">`                        | `<img src="{heroAsset}">`                                         |
| Blueprint restating example's SEQUENCE entries verbatim               | Describe shape; point to example                                  |
| Two equivalent implementations in one rule with no selection guidance | Pick one canonical; the other goes under Variations with criteria |
| `Form 1` / `Form 2` used but not defined locally                      | Replace with descriptive names                                    |
| Example introduces a technique not in any blueprint                   | Add it to a blueprint or remove from example                      |
| Blueprint asserts `5.5×` but example uses `5.0×`                      | Blueprint should not assert; document range in How to Choose      |
| Rule uses real product copy ("HyperFrames Pro") in HTML               | Replace with placeholder string like `"HEADLINE"`                 |
| Color hex `#e91e63` baked into rule CSS                               | Replace with `{accentColor}` token                                |

## End-to-End Workflow

Adding a new scene type:

1. Sketch the choreography in seconds — 4 to 8 phases, each with intent
2. Identify which atomic techniques you need; create rules for any that don't exist yet (one rule per technique)
3. Write the example HTML first — it's the easiest to test (lint + render)
4. Write the blueprint with placeholders, deriving structure from the example but abstracting all specifics
5. Cross-link: blueprint declares `uses_rules:`; blueprint links to example as Golden Sample; rules link blueprint via Combinations
6. Update `SKILL.md` index with the new blueprint, any new rules, and the example

Refactoring existing files:

1. Pick ONE blueprint at a time — batching multiplies merge surprises
2. Read the blueprint, its example, and every referenced rule end-to-end
3. Run the diagnostic greps; list every violation
4. Apply Step 3 fix table from "Refactoring Existing Files"
5. Re-run diagnostics — they must be empty
6. Verify example still passes lint (refactoring blueprint shouldn't touch example, but always check)
7. Update `SKILL.md` index if metadata shifted
