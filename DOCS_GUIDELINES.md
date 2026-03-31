# Documentation Guidelines

Standards for writing and maintaining Hyperframes documentation. Based on patterns from Remotion, Stripe, Tailwind CSS, and Astro.

## Core Principles

1. **One-sentence intro rule** — Every page opens with a single sentence telling the reader what this page helps them do or understand. No preamble, no history.

2. **Outcome before implementation** — Show what the code produces (rendered result, terminal output, file structure) before showing the code itself.

3. **Show, don't tell** — Use concrete examples with realistic values. Never use `foo`/`bar`/`baz`. Prefer a working HTML snippet over a description of what to write.

4. **Two content modes** — Guides build narratives with progressive complexity. References enable scanning with standardized structure. Never mix them.

5. **No dead ends** — Every page links forward (next steps), backward (prerequisites), and sideways (related concepts). Readers should never reach a page with nowhere to go.

## Page Structure

### Guides (concepts/, guides/)

```
Title
├── One-sentence purpose statement
├── What this looks like (output, demo, or visual)
├── Minimal working example
├── Deeper explanation with progressive complexity
├── Common patterns / best practices
├── Warnings and pitfalls (sparingly)
└── Next steps (cards or links to related pages)
```

### Reference pages (reference/)

```
Title
├── One-sentence definition
├── Complete attribute/API table
├── Detailed section per item (type, default, description, example)
├── Rules and constraints
└── Related pages
```

### Package pages (packages/)

```
Title
├── One-line description + install command
├── When to use this package (and when NOT to)
├── Key features list
├── Minimal usage example with expected output
├── Configuration reference
└── Related packages
```

## Writing Style

- **Second person, active voice, imperative mood**: "Use X to do Y." Not "The developer should consider using X."
- **Present tense**: "The runtime manages media playback." Not "The runtime will manage..."
- **Be direct**: "This breaks rendering." Not "This may potentially cause issues with the rendering pipeline."
- **Prerequisites at point of need**: State requirements where they matter, not in a wall at the top.
- **Conversational but precise**: Friendly tone, exact technical details.

## Code Examples

### Always annotate code blocks

```mdx
```html index.html
<div data-composition-id="root" ...>
```​
```

The filename after the language tag tells readers where the code goes.

### Use numbered comments for multi-step code

```javascript
// 1. Create a paused timeline
const tl = gsap.timeline({ paused: true });

// 2. Add animations
tl.from("#title", { opacity: 0, y: -50, duration: 1 }, 0);

// 3. Register the timeline
window.__timelines["my-video"] = tl;
```

### Show expected output

After CLI commands, show what the user should see:

```bash
npx hyperframes preview
# ✓ Server running at http://localhost:3000
# ✓ Watching for changes...
```

### Use CodeGroup for multi-platform commands

```mdx
<CodeGroup>
```bash macOS
brew install ffmpeg
```​
```bash Ubuntu
sudo apt install ffmpeg
```​
</CodeGroup>
```

## Mintlify Components — When to Use

| Component | Use When |
|-----------|----------|
| `<Steps>` | Sequential setup or tutorial instructions |
| `<CodeGroup>` | Same action across platforms/languages |
| `<Tabs>` | Alternative approaches with equal weight |
| `<Card>` / `<Columns>` | Navigation to related pages, next steps |
| `<Accordion>` | FAQ or optional detail that would bloat the page |
| `<Note>` | Non-obvious behavior the reader should know |
| `<Warning>` | Something that will break if ignored |
| `<Tip>` | Helpful shortcut or best practice |
| `<Info>` | Context that aids understanding |
| `<Tree>` | File/directory structure |
| `<Frame>` | Screenshots or diagrams with captions |

### Callout budget: max 2-3 per page

More than 3 callouts creates alert fatigue and readers skip them all. Reserve `<Warning>` for things that genuinely break. Use inline prose for tips.

## Cross-Linking

- **Link at the point of curiosity**: When you mention a concept that has its own page, link it immediately. Don't hoard links.
- **"See also" at page bottom**: Only for genuinely related content that doesn't fit inline.
- **Next steps cards**: End guide pages with `<Card>` links to logical next pages.

## File Conventions

- All doc pages are `.mdx` (not `.md`)
- Use kebab-case for filenames: `frame-adapters.mdx`, not `frameAdapters.mdx`
- Frontmatter requires `title` and `description`
- Description should be under 160 characters (used for SEO/social)

## Maintenance

- Docs live in the repo at `/docs` and deploy automatically on merge to `main`
- PRs that change user-facing behavior should update relevant doc pages
- Run `mint validate` and `mint broken-links` before pushing doc changes
