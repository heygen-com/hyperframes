# HyperFrames documentation rules

Before changing a page, read its complete body and verify product behavior in
the current source, tests, CLI help, or shipped skills.

- Write for a smart general user first. Do not assume they are a developer.
- Explain what a person can accomplish before explaining implementation details.
- Prefer plain words, short examples, screenshots, and visible outcomes.
- Keep agent instructions copyable and specific.
- Put CLI, SDK, package, schema, deployment, and internals under **Developers**.
- Never infer product behavior from page titles or old docs. Verify it in current code.
- Do not preserve a page merely because it already exists. Merge, rewrite, redirect, or remove it when that improves the user journey.
- Do not publish empty, duplicated, outdated, or aspirational content as fact.
- A page should answer a real question or help complete a real task.
- Preserve the approved Mintlify header, sidebar, right-side contents, and page-width behavior unless a task explicitly changes the site chrome.

## Page standard

Most human-facing pages should contain:

1. What this lets you do
2. When to use it
3. A visual or concrete example
4. The shortest successful path
5. What should happen
6. Common problems
7. Useful next steps

Do not force this structure where it makes a page worse. Reference pages may stay reference-shaped.

## Component doctrine

One component per job. If two components on a page render the same list, delete one.

| The job | Use | Never use |
| --- | --- | --- |
| Choose between destinations | `CardGroup` + `Card`, max 2 columns, linking to the real page | An accordion, or cards pointing at anchors on the same page |
| Ordered instructions | `Steps` | A flow diagram that repeats the same steps |
| Parallel variants of one instruction (source type, OS, language) | `Tabs` | Repeating the whole block per variant |
| Compare attributes across items | A table | Prose paragraphs per item |
| Static image | `Frame` with a caption that says what it is | A bare `img` with no context |
| Genuinely out-of-band aside | One `Note`, `Tip`, or `Warning` per page | Stacked callouts, or a callout for ordinary prose |

**Do not use accordions for journeys, choices, instructions, or troubleshooting.** They hide the thing the reader needs, cost a click, and weaken `Cmd+F`, printing, and deep linking. A dense optional reference or example gallery may keep accordions when showing every item at once would make the page unusable. Two patterns in the Prompt Guide are the standing exceptions: its verified-example gallery, and the per-page `## Variants` blocks. Those hold long alternative prompts rather than parallel instructions, so the `Tabs` row above does not apply — a reader picks one to read in full, not one of several ways to do the same step. Long symptom or task lists become visible `##` sections instead — they get anchors the support team can link directly, and they appear in the page contents.

**No diagram that restates adjacent prose.** A four-node flow beside a four-step list is the same content twice. Keep whichever is more useful and delete the other.

**Cards link to pages, never to anchors on the current page.** A card that scrolls the reader a short distance to the same words is the worst pattern in these docs; it has been removed twice.

**Two columns is the practical maximum** for anything containing text. Three columns in this content width hyphenates titles mid-word.

**Full films and preview loops are different jobs.** Use `DocsVideo` for a
narrated film a reader watches intentionally. A plain `<video>` is only for a
small, muted, autoplaying preview loop inside a visual explanation or Catalog
item. Do not mix native browser controls with the custom player.

**End a page by pointing somewhere, and make the pointer visible content.**
Mintlify does not render a `related:` frontmatter list, so a frontmatter key
buys nothing. How the pointer looks depends on the page:

- Task, guide, Studio, and Catalog pages end with a `## Related topics` section
  naming the two or three destinations that genuinely help the reader continue.
- Pages in a numbered sequence — the Prompt Guide — end with a single
  `*Next: [page] — why*` line instead. A course has one useful destination, and
  three competing links break the through-line.
- Reference and concept pages (`/packages`, `/sdk`, `/reference`, `/concepts`)
  may end without either. A reader arrives there from one specific question and
  leaves the same way; inventing three related links is filler.

### Custom React components

Mintlify compiles `.jsx` / `.tsx` from `docs/snippets/`. Use one when a native component genuinely cannot express the idea — a scrubber, a comparison slider, a live player — not for styling.

- Named exports only: `export const Thing = () => ...`. Default exports do not work.
- `useState`, `useEffect`, `useRef`, `useCallback`, `useMemo`, `useContext`, `useReducer` are pre-injected; do not import React.
- **Do not add a dependency or CDN script for presentation alone.** Prefer browser built-ins (`fetch`, `IntersectionObserver`, Canvas, `<video>`). A version-pinned official runtime is acceptable when that runtime is the subject of the demo and the component provides a useful loading or failure state; the live composition on Introduction is the model.
- A snippet cannot import another snippet. Keep each self-contained.
- **Declare everything inside the component.** Only the exported component survives
  compilation; module-level `const`s above it are dropped, so a constant defined
  outside arrives `undefined` at render. The component then throws inside React,
  the error boundary swallows it, and the page renders nothing at that position —
  with no console error to point at it. If a snippet renders blank, check this first.
- Client-side only: guard anything touching `window` and give every component a sensible first paint.
- Respect `prefers-reduced-motion`, give interactive elements a visible focus state, and never make a component the only route to information.

## Verification

After navigation or MDX changes:

```bash
PATH=/opt/homebrew/opt/node@20/bin:$PATH mint validate
PATH=/opt/homebrew/opt/node@20/bin:$PATH mint broken-links
```

Use Bun for repository work. Do not create a `pnpm-lock.yaml`.

## Freshness and ownership

- A product behavior page is owned by the team that owns the matching product surface.
- A package or API reference is owned by the package maintainer.
- Workflow pages are owned by the maintainer of the matching agent skill.
- When a feature changes, update its task guide, related troubleshooting entry, and screenshot in the same pull request.
- Treat screenshots as product claims. Replace them when labels, layout, or the demonstrated workflow changes materially.
- Review **Start here**, **Studio**, **Export**, and **Troubleshooting** at least once per release cycle.
- Review lower-traffic reference pages at least quarterly.
- Remove an unowned update feed instead of letting it become stale.
- Use search analytics and support questions to decide which missing task pages to add next.
