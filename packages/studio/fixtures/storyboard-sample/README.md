# storyboard-sample (Studio fixture)

A small, self-contained project for dogfooding the Studio **Storyboard** view.
Not a registry catalog item — it lives here purely as test content for the
storyboard UI/UX work.

It exercises the storyboard contract end to end:

- `STORYBOARD.md` — structured manifest (frontmatter + 5 frames) in the canonical
  format the parser reads.
- `compositions/frames/0{1..4}-*.html` — live HTML frame sub-compositions
  (`built` / `animated` statuses) the contact-sheet tiles render.
- Frame 5 (`05-cta.html`) is intentionally **absent** and `status: outline`, so
  the grid has an outline placeholder to render.

Preview the storyboard view:

```bash
npx hyperframes preview packages/studio/fixtures/storyboard-sample
```

Inspect just the parsed manifest the Studio consumes:

```bash
curl localhost:<port>/api/projects/<id>/storyboard | jq
```
