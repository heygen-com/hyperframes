# User memory — preferences and recipes

## Preferences — remembered defaults

The lightweight tier of user memory: confirmed brief answers (destination, aspect, language, flow, storyboard, voice, style preset) persisted on the same two-tier split as assets — project `.media/preferences.json` (committed, the team inherits it) and personal `~/.media/preferences.json`. A value earns the personal tier by being confirmed in **two different projects**, so a one-off choice never pollutes the global defaults.

```bash
node <SKILL_DIR>/scripts/prefs.mjs get --hyperframes . --json      # merged view (project overrides user)
node <SKILL_DIR>/scripts/prefs.mjs record --hyperframes . --key destination --value x-feed
node <SKILL_DIR>/scripts/prefs.mjs record --hyperframes . --key style_preset --value pin-and-paper --workflow faceless-explainer
```

Only what the user actually confirmed gets recorded — never an inferred or defaulted value. How workflows consume these (a remembered value becomes the recommended default with a receipt, and never skips a question) is the brief contract's rule: `hyperframes-core/references/brief-contract.md` § 2, Remembered defaults.

## Recipes — frozen video bundles

The heavyweight tier of user memory: one approved run frozen as a named, versioned bundle — `frame.md`, the storyboard skeleton (structure kept, content blanked to per-frame fill-ins), the brief skeleton (from `BRIEF.md` when the project has one — reusable frontmatter kept, run-shape and prose blanked), and the confirmed brief values. Same two tiers: project `.media/recipes/<name>/` (committed) and `~/.media/recipes/<name>/` (a freeze is already a confirmed bundle, so it promotes immediately — no two-project rule). Re-freezing a name bumps `version` and archives the old folder as `<name>@v<N>`.

```bash
node <SKILL_DIR>/scripts/recipe.mjs freeze --hyperframes . --name weekly-promo   # workflow read from BRIEF.md (--workflow only for briefless projects)
node <SKILL_DIR>/scripts/recipe.mjs list --hyperframes . --workflow product-launch-video
node <SKILL_DIR>/scripts/recipe.mjs use --hyperframes . --name weekly-promo   # also: resolve.mjs --type recipe --entity weekly-promo
```

The freeze is offered once after the final approval (`hyperframes-core/references/review-loop.md` § 4), and the intent layer (`/hyperframes` → `references/intent-interview.md`, step 1) checks for a match before its first question. Adopting a recipe fills the brief, the design spec, and the storyboard skeleton — and unlike preferences it may skip the questions it answers: the bundle was approved as a whole, and adoption itself is the question.

## Files

- `.media/manifest.jsonl`: machine SSOT, one JSON record per line
- `.media/index.md`: agent-readable table (id, type, dur, dims, path, description)
- `.media/preferences.json`: the project's remembered defaults (committed)
- `~/.media/`: global cross-project reuse cache (content-addressed, SHA-256)
- `~/.media/preferences.json`: personal remembered defaults (promoted after two projects)
- `.media/recipes/<name>/`: frozen video bundles — recipe.json + frame.md + storyboard skeleton (committed)
- `~/.media/recipes/<name>/`: personal recipe tier (promoted on freeze)
- `~/.media/misses.jsonl`: local-only resolve misses, including intent text for `--stats`
