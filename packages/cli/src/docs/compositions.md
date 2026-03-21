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
Compositions can expose variables for dynamic content:
```html
<div data-composition-id="card" data-var-title="string" data-var-color="color">
```
