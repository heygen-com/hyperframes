# Design Picker

Create a `design.md` by serving a visual picker page where the user configures 7 independent categories.

## Prerequisites

Before generating options, read these style references — all options must comply:

- [typography.md](typography.md) — banned font list, cross-category pairing (serif + sans or sans + mono, never two sans-serifs), weight contrast (300-400 body / 700-900 headline), video-sized text (60px+ headlines, 20px+ body, 16px+ labels)
- [../house-style.md](../house-style.md) — lazy defaults to avoid (no gradient text, no left-edge accent stripes, no pure #000/#fff, no identical card grids, no banned fonts)
- [motion-principles.md](motion-principles.md) — ease diversity, varied entry directions, scene structure

## Building the picker

1. Generate 2-3 visual directions based on the prompt. Each direction needs: name, mood, colors (bg/fg/accent), fonts (headline/body), energy level, and transition style.
2. `mkdir -p .hyperframes` then copy [../templates/design-picker.html](../templates/design-picker.html) to `.hyperframes/pick-design.html`.
3. Replace `__ARCHITECTURES_JSON__`, `__PALETTES_JSON__`, and `__TYPEPAIRS_JSON__` with your generated options. The user picks one from each category independently — structure, palette, type pairing, plus theme (dark/light/full palette), corners, density, and depth.

### Architecture data format

Each architecture object must include a `preview_html` field — the HTML that renders in the preview panel. Use token placeholders that the template replaces at runtime: `{{bg}}`, `{{fg}}`, `{{ac}}`, `{{mt}}`, `{{hf}}`, `{{hw}}`, `{{bf}}`, `{{bw}}`, `{{cr}}` (corner radius), `{{pad}}`, `{{gap}}`, `{{shadow}}`, `{{g}}` (grid line color), `{{fg3}}`/`{{fg6}}`/`{{fg8}}`/`{{fg15}}` (fg at opacity), `{{ac3}}`/`{{ac5}}`/`{{ac25}}` (accent at opacity).

**Every token must be used.** Apply `{{cr}}` to all cards, buttons, and containers. Apply `{{shadow}}` to elevated elements (cards, buttons, code blocks). Apply `{{pad}}` and `{{gap}}` to control spacing. If a token isn't used in the preview_html, that option will have no visible effect.

**Density matters.** Each architecture preview must include 15+ distinct elements to give the user a real sense of the layout. Include: headline, subhead, body paragraph, label/overline, stat with number, secondary stat, quote/testimonial, attribution, card with title+body, second card (different treatment), code/command block, primary button, secondary button, list or tags, accent divider/rule, and a data element (table row, progress bar, or chart).

Optionally include `components` (component styling rules) and `dos` (do's and don'ts) as strings — these appear in the generated design.md.

**Layout constraint:** All preview HTML must use percentage widths or `max-width: 100%`. Use `flex-wrap: wrap` on all flex rows. Absolute-positioned decoratives must stay within a parent with `overflow: hidden`.

**Security:** Architecture `preview_html` must not contain `<script>` tags, event handlers (`onclick`, `onerror`, etc.), or `javascript:` URLs. It is injected via `innerHTML`.

**Palette variety:** Always include a mix of light, dark, and tinted backgrounds across the 6 palettes — even for calm/wellness prompts.

### Example architecture object

```json
{
  "name": "Editorial Stack",
  "description": "Vertical rhythm with large type, pull quotes, and data callouts",
  "tag": "editorial / longform / narrative",
  "mood": "Confident, unhurried, typographically driven",
  "preview_html": "<div style='background:{{bg}};color:{{fg}};padding:{{pad}};min-height:100vh;font-family:\"{{bf}}\",sans-serif;font-weight:{{bw}};'><div style='max-width:100%;display:flex;flex-direction:column;gap:{{gap}};'><div style='font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:{{mt}};'>Overline Label</div><div style='font-family:\"{{hf}}\",serif;font-weight:{{hw}};font-size:48px;line-height:1.1;letter-spacing:-0.02em;'>The Headline Goes Here</div><div style='font-size:20px;color:{{mt}};max-width:70%;line-height:1.5;'>Subheading text that introduces the narrative arc of this composition with enough words to fill two lines.</div><div style='font-size:15px;line-height:1.7;color:{{fg}};max-width:65%;'>Body paragraph with real sentences. The quick brown fox jumps over the lazy dog. This gives a sense of text density and reading rhythm at the chosen type size.</div><div style='display:flex;gap:{{gap}};flex-wrap:wrap;'><div style='background:{{fg6}};border-radius:{{cr}};padding:{{pad}};flex:1;min-width:200px;box-shadow:{{shadow}};'><div style='font-size:36px;font-family:\"{{hf}}\",serif;font-weight:{{hw}};color:{{ac}};'>2.4M</div><div style='font-size:12px;color:{{mt}};margin-top:4px;'>Primary Stat</div></div><div style='background:{{fg6}};border-radius:{{cr}};padding:{{pad}};flex:1;min-width:200px;box-shadow:{{shadow}};'><div style='font-size:36px;font-family:\"{{hf}}\",serif;font-weight:{{hw}};color:{{fg}};'>87%</div><div style='font-size:12px;color:{{mt}};margin-top:4px;'>Secondary Stat</div></div></div><div style='border-left:3px solid {{ac}};padding:12px {{pad}};background:{{ac3}};border-radius:0 {{cr}} {{cr}} 0;'><div style='font-size:18px;font-style:italic;color:{{fg}};line-height:1.5;'>\"A pull quote that captures the key insight of the piece.\"</div><div style='font-size:12px;color:{{mt}};margin-top:8px;'>— Attribution Name</div></div><div style='background:{{fg3}};border-radius:{{cr}};padding:{{pad}};box-shadow:{{shadow}};'><div style='font-size:14px;font-weight:{{hw}};margin-bottom:8px;'>Card Title</div><div style='font-size:13px;color:{{mt}};line-height:1.5;'>Card body text with a different treatment than the main content area.</div></div><div style='background:{{ac5}};border:1px solid {{ac25}};border-radius:{{cr}};padding:{{pad}};box-shadow:{{shadow}};'><div style='font-size:14px;font-weight:{{hw}};color:{{ac}};margin-bottom:8px;'>Accent Card</div><div style='font-size:13px;color:{{fg}};line-height:1.5;'>Second card with a tinted accent treatment for variety.</div></div><div style='font-family:monospace;font-size:13px;background:{{fg8}};border-radius:{{cr}};padding:{{pad}};color:{{fg15}};box-shadow:{{shadow}};'>$ hyperframes render --output video.mp4</div><div style='display:flex;gap:12px;flex-wrap:wrap;'><button style='background:{{ac}};color:{{bg}};border:none;padding:10px 24px;border-radius:{{cr}};font-size:14px;font-weight:600;box-shadow:{{shadow}};cursor:pointer;'>Primary Action</button><button style='background:transparent;color:{{fg}};border:1px solid {{fg15}};padding:10px 24px;border-radius:{{cr}};font-size:14px;cursor:pointer;'>Secondary</button></div><div style='display:flex;gap:8px;flex-wrap:wrap;'><span style='background:{{fg6}};border-radius:100px;padding:4px 12px;font-size:11px;color:{{mt}};'>Tag One</span><span style='background:{{fg6}};border-radius:100px;padding:4px 12px;font-size:11px;color:{{mt}};'>Tag Two</span><span style='background:{{ac5}};border-radius:100px;padding:4px 12px;font-size:11px;color:{{ac}};'>Accent Tag</span></div><div style='height:1px;background:linear-gradient(to right,{{ac25}},{{fg6}},{{ac25}});'></div><div style='display:flex;justify-content:space-between;font-size:12px;color:{{mt}};border-bottom:1px solid {{g}};padding:8px 0;'><span>Data row label</span><span style='color:{{fg}};font-weight:600;'>1,234</span></div></div></div>"
}
```

## Serving and user selection

4. Serve the file: `cd <project-dir> && python3 -m http.server 8723 &` (use port 8723 or any unused port above 8000; if the curl check fails, try the next port). Verify: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8723/.hyperframes/pick-design.html` — only share the link if it returns 200. Do NOT use `npx hyperframes preview` for the picker — it blocks. Only start the HTTP server from the main conversation thread. If you are running as a dispatched task or subagent, return the file path and let the caller serve it.
5. Once the user picks, tell them: "Copy the design.md from the picker and paste it here." The user pastes the markdown back into the conversation. Save it to `design.md` in the project root. After the user pastes, kill the background server: `kill %1` or `kill $(lsof -ti:8723)`. Then proceed with construction.

The design.md format is generated by the picker template — it includes mood, theme, structure, colors, typography, corners, spacing, depth, components, and do's/don'ts based on the user's selections.
