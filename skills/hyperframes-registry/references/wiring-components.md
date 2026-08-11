# Wiring Components

Components are effect snippets — HTML, CSS, and optionally JS that you merge directly into an existing composition. Unlike blocks, components have no standalone timeline; they participate in the host composition's timeline.

## General process

1. Run `hyperframes add <component-name>`
2. Open the installed file (e.g., `compositions/components/grain-overlay.html`)
3. Read the comment header for usage instructions
4. Copy the parts into your host composition:
   - **HTML elements** — inside your `<div data-composition-id="...">`
   - **CSS styles** — into your composition's `<style>` block
   - **JS setup** — into your composition's `<script>`, before your timeline code
   - **Timeline wiring** — call the component's CONFIG-reading helper at a position on
     your GSAP timeline (e.g. `tl.add(sweepBuild(el), 2.0)`). The helper owns its internal
     durations, eases, and staggers, mapped from the component's declared controls — raw
     tween args never migrate into host code

## Example: grain-overlay (CSS-only, no timeline integration)

```html
<!-- Paste the overlay div into your composition -->
<div
  id="grain-overlay"
  style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 100;"
>
  <div class="grain-texture"></div>
</div>
```

Then paste the CSS keyframes and `.grain-texture` rule into your styles. No GSAP timeline calls needed — the grain animates via CSS `@keyframes`.

## Example: shimmer-sweep (needs timeline integration)

See `examples/add-component.md` for the full shimmer-sweep walkthrough (HTML wrapping, CSS, JS setup, and timeline call).

## Key principles

- Components inherit the host composition's dimensions and duration
- Place component HTML at the appropriate z-index relative to your content
- Customize via the component's declared controls in its `CONFIG` block (the comment
  grammar documents each) and the host token layer (`--*` CSS custom properties);
  everything else is locked — the host owns _where_ the component sits on the timeline,
  the component owns _how_ it moves
- Run `hyperframes lint` after wiring to catch structural issues
