# GSAP Animation

HyperFrames uses GSAP for animation. Timelines are paused and controlled by the runtime.

## Setup
```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.to("#title", { opacity: 1, duration: 0.5 }, 0);
  window.__timelines = window.__timelines || {};
  window.__timelines["root"] = tl;
</script>
```

## Key Rules
- Always create timelines with `{ paused: true }`
- Register timelines on `window.__timelines` with the composition ID as key
- Position parameter (3rd arg) sets absolute time: `tl.to(el, vars, 1.5)`
- Supported methods: `set`, `to`, `from`, `fromTo`

## Supported Properties
opacity, x, y, scale, scaleX, scaleY, rotation, width, height, visibility
