# Parameter translation: Zod schemas, defaultProps, calculateMetadata

How a typed Remotion `<Composition schema={...} defaultProps={...} />`
turns into a parameterized HF composition.

## Sync calculateMetadata (translatable)

```tsx
<Composition
  id="MyVideo"
  component={MyVideo}
  schema={z.object({ title: z.string(), duration: z.number() })}
  defaultProps={{ title: "Hello", duration: 90 }}
  calculateMetadata={({ props }) => ({
    durationInFrames: props.duration,
    fps: 30,
  })}
/>
```

When `calculateMetadata` is synchronous and only uses `props`, **resolve
it at translation time** — call it with `defaultProps` (or whatever the
caller specifies) and write the concrete result into the HTML:

```html
<div
  id="stage"
  data-composition-id="MyVideo"
  data-start="0"
  data-duration="3"          <!-- 90/30 -->
  data-fps="30"
  data-title="Hello"
></div>
```

The `data-title` attribute carries the value through. Code that originally
read `props.title` reads `document.getElementById("stage").dataset.title`
in HF.

Inside a scene sub-composition file that lookup does not reach the root
`#stage`. Pass a prop to a scene with `data-variable-values` on its host and
read it there with `window.__hyperframes.getVariables()` (declare defaults with
`data-composition-variables` on the scene's composition element).

## Async calculateMetadata (NOT translatable)

```tsx
<Composition
  calculateMetadata={async ({ props }) => {
    const res = await fetch(...);
    return { durationInFrames: res.duration };
  }}
/>
```

**Refuse + interop**. HF needs composition metadata up-front to seed the
HTML. Resolving network calls at translation time defeats the purpose
of having dynamic metadata. See [escape-hatch.md](escape-hatch.md).

The lint rule `r2hf/async-metadata` catches this. T4 case 03 tests it.

## Default props

```tsx
defaultProps={{
  title: "Hello",
  subtitle: "World",
  count: 42,
}}
```

Translate to `data-*` attributes on the root `#stage` div:

```html
<div id="stage" data-title="Hello" data-subtitle="World" data-count="42">...</div>
```

Convention: `propName` → `data-prop-name` (kebab-case). Inside the GSAP
script, read via `document.getElementById("stage").dataset.propName`.

## Nested object / array props

```tsx
defaultProps={{
  stats: [
    { label: "Stars", value: 1247, color: "#fbbf24" },
    { label: "Forks", value: 312, color: "#60a5fa" },
  ],
}}
```

Don't try to encode the array as a JSON `data-` attribute — HF's runtime
doesn't parse those. Materialize the array as **repeated HTML markup**:

```html
<div id="scene-stats">
  <div class="stat-card" data-stat-index="0" data-stat-value="1247" style="--card-color:#fbbf24">
    <div class="number">0</div>
    <div class="label">Stars</div>
  </div>
  <div class="stat-card" data-stat-index="1" data-stat-value="312" style="--card-color:#60a5fa">
    <div class="number">0</div>
    <div class="label">Forks</div>
  </div>
</div>
```

The component template (`StatCard.tsx`) becomes the markup template;
each instance gets its scalar props rendered as `data-*` and CSS
custom properties.

Validated in T3 — three StatCards reused with different props,
mean SSIM 0.953.

## Numeric props that need typed parsing

`document.getElementById("stage").dataset.count` is a string. Convert at
read time:

```js
const count = Number(stage.dataset.count);
```

Or inline values directly into the GSAP script when the data is known
at translation time and doesn't need to vary per render.

## Boolean props

```tsx
defaultProps={{ darkMode: true }}
```

Two conventions:

- `data-dark-mode="true"` — read as string, compare `=== "true"`
- `data-dark-mode` (presence/absence) — `<div data-dark-mode>` for true, omit for false

Pick one and be consistent. The presence/absence form is HTML-idiomatic
and pairs well with CSS attribute selectors:

```css
[data-dark-mode] .scene {
  background: #000;
}
```

## Zod runtime validation

Remotion's `schema` validates props at composition load. HF doesn't have
an equivalent — by the time the HTML is in the renderer, the schema is
already gone.

Validate at translation time instead. If the user passes invalid data,
fail with a translation error before emitting HTML. This matches Zod's
"fail loud" intent without requiring the runtime dependency.

## When the composition uses props for computed prop derivation

```tsx
const Composition: React.FC<Props> = ({ stats }) => {
  const total = stats.reduce((acc, s) => acc + s.value, 0);
  return <div>{total}</div>;
};
```

Compute the derived value at translation time and bake it into the HTML
or a `data-` attribute. Don't try to express the computation in JS in the
HF composition — that adds runtime overhead and makes the HTML stateful
in ways that complicate human editing.

If the derivation is non-trivial (involves the array itself, not just
scalars), materialize it as static text in the HTML.
