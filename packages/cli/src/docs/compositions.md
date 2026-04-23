# Compositions

A composition is an HTML document that defines a video timeline.

## Structure

Every composition needs a root element with `data-composition-id`:

```html
<div id="root" data-composition-id="root" data-width="1920" data-height="1080">
  <!-- Elements go here -->
</div>
```

## Nested Compositions

Embed one composition inside another:

```html
<div data-composition-src="./intro.html" data-start="0" data-duration="5"></div>
```

## Listing Compositions

Use `npx hyperframes compositions` to see all compositions in a project.

## Variables

HyperFrames does not automatically bind `data-var-*` attributes into your composition DOM.

```html
<div
  data-composition-id="card"
  data-composition-src="compositions/card.html"
  data-variable-values='{"title":"Hello","color":"#ff4d4f"}'
></div>
```

Read `data-variable-values` inside the nested composition and apply the values in your own script. Variable metadata for tooling is declared separately via `data-composition-variables` and read with `extractCompositionMetadata()`.
