# Theme token contract

Theme packs provide one global value for every contract token. Primitive HTML consumes these tokens at the point of use with a fallback, for example `var(--fg, #f8fafc)`. Primitive HTML must not declare contract tokens in `:root` because those declarations escape composition scoping.

The source plan calls this a 16-token contract, but its enumerated list contains 17 properties because the three spacing tokens are separate properties. The BUILT primitive audit adds `--accent-2`, which is consumed by three background primitives. The effective gate contract therefore contains 18 tokens.

## Final token set

| Group             | Tokens                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------- |
| Palette           | `--bg`, `--fg`, `--muted`, `--surface`, `--border`, `--brand`, `--accent`, `--accent-2` |
| Type              | `--font-display`, `--font-body`, `--font-mono`                                          |
| Shape and spacing | `--radius`, `--space-1`, `--space-2`, `--space-3`                                       |
| Motion            | `--dur-beat`, `--ease-standard`, `--ease-emphasis`                                      |

`--accent-2` is part of the contract because `aurora-drift`, `grain-field`, and `beat-pulse-background` consume it. `--demo-bg` is not a primitive token. It is local to two demo harnesses and should remain outside reusable primitive styling.

## One-off contract violations

These theme-like tokens are each consumed by only one BUILT primitive and must be normalized later. They are not supplied by the theme packs.

| Token            | Primitive      | Normalize toward                                          |
| ---------------- | -------------- | --------------------------------------------------------- |
| `--radius-lg`    | `OutlineDraw`  | `--radius`                                                |
| `--shadow-panel` | `OutlineDraw`  | A local shadow composed from contract palette tokens      |
| `--space-4`      | `pan-stations` | The nearest `--space-1`, `--space-2`, or `--space-3` step |
| `--space-5`      | `pan-stations` | The nearest `--space-1`, `--space-2`, or `--space-3` step |
| `--space-8`      | `OutlineDraw`  | The nearest `--space-1`, `--space-2`, or `--space-3` step |

## Theme pack rules

Each theme file contains exactly one `:root` block and defines all 18 tokens. Theme packs are the only files in this directory allowed to declare contract tokens globally. A staged theme block is injected at the end of the QA page head, re-targeted at :root, #root, [data-composition-id] with !important on every declaration: demos declare contract tokens at element scope (#root), which a plain :root injection can never override for descendants.
