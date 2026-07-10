# Shared test scenes

Permanent, shared, multi-primitive frames used to screen a HyperFrames video primitive before
it ships (ADR-0008). A primitive's own demo has no neighbors, so it can't catch attention
conflicts, illegibility at partial size, or simultaneous-entrance clashes. These scenes exist
so every primitive is judged in the same busy, realistic context.

Scenes are shared on purpose: per-builder scenes were rejected because builders tend to author
scenes their own primitive looks good in. Point the matching slot at the primitive, render, and
read the result cold.

## Files

- `saas-landscape.html`: dark-theme SaaS launch frame (1920x1080), headline + fake UI panel
  chrome, four slots (`slot-demonstrate`, `slot-emphasize`, `slot-reveal`, `slot-payoff`).
- `saas-landscape-light.html`: identical skeleton, light-theme token values. Catches a
  primitive that only reads correctly on a dark background.
- `mobile-device-stage.html`: dark-theme frame centered on a portrait phone placeholder, three
  slots (`slot-demonstrate` is the phone's screen, `slot-emphasize` sits beside the device,
  `slot-payoff` sits above it). Catches a primitive that only reads at 16:9.
- `slots/empty.html`: the default placeholder every unfilled slot points at, a faint dashed
  outline with an "empty slot" label, no motion.

## Which slot for which job

Slot names are the primitive's job, not its position:

| Slot               | Job                                           | Present in                                         |
| ------------------ | --------------------------------------------- | -------------------------------------------------- |
| `slot-demonstrate` | Show the product/feature doing the thing      | all three scenes                                   |
| `slot-emphasize`   | Draw attention to a point near existing copy  | all three scenes                                   |
| `slot-reveal`      | Introduce something mid-stage, secondary beat | `saas-landscape.html`, `saas-landscape-light.html` |
| `slot-payoff`      | Land the final beat, smallest/corner slot     | all three scenes                                   |

A primitive ships only after it passes the scene matching its **primary** job. Screening
against the other scenes (dark vs. light, desktop vs. phone container) is strongly recommended
but the primary-job scene is the hard gate.

## How to screen a primitive

1. Open the scene whose theme/format matches what you want to check (dark, light, or phone
   container), and find the slot matching the primitive's job.
2. Swap that slot's `data-composition-src` to point at the primitive's demo file, and update
   `data-composition-id` on the same element to match the demo file's own internal
   `data-composition-id` (the host id is the `window.__timelines` lookup key, it must equal the
   loaded file's id exactly, see `skills/hyperframes-core/references/sub-compositions.md`,
   Pitfall 2). One line changes twice:

   ```html
   <!-- before -->
   <div
     id="slot-demonstrate"
     class="clip slot"
     data-composition-id="empty-slot"
     data-composition-src="./slots/empty.html"
     ...
   ></div>

   <!-- after -->
   <div
     id="slot-demonstrate"
     class="clip slot"
     data-composition-id="my-primitive"
     data-composition-src="../primitives/my-primitive/demo.html"
     ...
   ></div>
   ```

   Leave the other slots pointed at `slots/empty.html` unless you're deliberately screening two
   primitives together for a conflict check.

3. Render and read the filmstrip:

   ```bash
   # standard path
   npx hyperframes render registry/test-scenes/saas-landscape.html

   # fast filmstrip diagnostic
   node /Users/miguel07code/dev/hyperframes-corpus-data/tools/filmstrip.mjs registry/test-scenes/saas-landscape.html
   ```

4. Read the filmstrip cold: does the primitive stay legible against the chrome, does its
   entrance read cleanly against the stagger, does it hold its own next to whatever else is
   filled in. If a second slot is also filled, check the frame where both entrances overlap in
   time, that's the moment most likely to expose an attention conflict.

A primitive ships only after it passes the scene matching its primary job.
