# Cut the Curve — GSAP code templates (moved)

The templates now live INSIDE each technique's recipe file, so a packet or a single
read carries params + code together:

| Technique             | Code now in                                      |
| --------------------- | ------------------------------------------------ |
| Zoom-Through          | `../seams/zoom-through.md`                       |
| Inverse Zoom-Through  | `../seams/inverse-zoom-through.md`               |
| Cut the Curve (+zoom) | `../seams/cut-the-curve.md`                      |
| Waterfall Cut         | `../seams/waterfall-cut.md`                      |
| Rack-Focus Blur-Cut   | `../seams/rack-focus-blur-cut.md`                |
| Waterfall Entry       | `hyperframes-animation/rules/waterfall-entry.md` |
| Nudge Curve           | `hyperframes-animation/rules/nudge-curve.md`     |

Worker-authored versions tween in-scene elements; registry `gsap_template`s are
injector-stamped onto the two clip wrappers (`__OLD__` / `__NEW__` / `__T__` / `__DUR__`
tokens — see `seam-craft` for the token table).
