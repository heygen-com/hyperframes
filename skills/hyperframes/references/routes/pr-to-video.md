# Route: pr-to-video

- **Input:** A GitHub PR URL, `owner/repo#N`, or "this PR", read through `gh`; it is not a website capture request.
- **Output:** A changelog, feature reveal, fix explainer, or refactor walkthrough with diff, before/after, file-tree, and impact scenes. Hard cap about 3 minutes; duration follows change size.
- **Triggers:** "make a video about this PR", "turn PR #1187 into a changelog video", "release-notes video from this pull request".

## Interview

- **Must-haves:** the **PR reference** (URL, `owner/repo#N`, or "this PR") · **angle** — changelog / feature-reveal / fix-explainer / refactor-walkthrough, recommend the one the PR itself suggests · **audience** — developers (default) · mixed technical · non-technical stakeholders · **length** — from the size table below · **destination** — 16:9 is the default for a code explainer.
- **Length comes from the PR's change size**, not a fixed guess — peek once, read-only (the workflow's Step 1 still does the full deterministic fetch):

  ```bash
  gh pr view <PR_REF> --json title,additions,deletions,changedFiles
  ```

  Pick the tier from `additions + deletions` (nudged up by `changedFiles`) and lead with it (hard cap ~3 min):

  | PR change size                    | Recommended length |
  | --------------------------------- | ------------------ |
  | trivial (≲ 50 lines changed)      | ~20–40s            |
  | focused (~50–200 lines)           | ~40–70s            |
  | substantial (~200–600 lines)      | ~70–110s           |
  | large (≳ 600 lines, or 25+ files) | ~110–180s          |

  State the basis in one phrase ("~40s — small change, +44/−13 across 12 files"). The tier is a **ceiling** on how much story the diff can support, never a floor to fill: a one-headline story recommends inside 30–90s regardless of tier (the tier's range may still appear as a non-recommended fuller-walkthrough option).

- **Pitch round:** `angle` and the opening hook — the diff fixes the facts, not the telling.
- **Run-shape:** both.
