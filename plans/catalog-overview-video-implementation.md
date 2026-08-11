# Catalog Overview Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `ce-work` to implement this plan task-by-task. Keep the checklist current and verify every claim from fresh command output.

**Goal:** Replace the dense Catalog overview with a short orientation page led by a silent, fast-cut HyperFrames montage covering all 11 Catalog sections.

**Architecture:** A tracked HyperFrames source project composes 11 existing Catalog preview films from frozen local assets. A small acquisition script downloads the immutable CDN sources before rendering, while a guarded Mintlify snippet handles autoplay and reduced motion. The rendered MP4 and poster publish through the existing docs CDN workflow; the MDX page references those immutable URLs.

**Tech Stack:** HyperFrames 0.7.107, HTML/CSS, TypeScript, Bun/Vitest, Mintlify, FFmpeg/ffprobe, AWS S3/CloudFront docs upload.

---

## File map

- Create `docs/video-sources/catalog-overview/index.html` — deterministic 11-beat HyperFrames composition.
- Create `docs/video-sources/catalog-overview/README.md` — exact acquisition, check, render, and publish commands.
- Create `scripts/catalog-overview-video/assets.ts` — single source of truth for section order, item IDs, media starts, and CDN URLs.
- Create `scripts/catalog-overview-video/prepare-assets.ts` — download and validate the frozen local MP4 inputs.
- Create `scripts/catalog-overview-video.test.ts` — contract tests tying section order, composition clips, page structure, and source manifest together.
- Create `docs/snippets/catalog-overview-loop.jsx` — one muted autoplay loop with reduced-motion teardown and poster fallback.
- Modify `docs/catalog/index.mdx` — simplified overview content and video embed.
- Modify `.gitignore` — ignore downloaded preview inputs and rendered local outputs while keeping source tracked.
- Create local-only `docs/images/showcase/catalog-overview-v1.mp4` and `catalog-overview-v1.jpg` — upload artifacts, never commit.

### Task 1: Pin the content and page contracts with a failing test

**Files:**

- Create: `scripts/catalog-overview-video.test.ts`

- [ ] **Step 1: Write the failing contract test**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import { catalogOverviewAssets } from "./catalog-overview-video/assets";

const root = resolve(import.meta.dirname, "..");
const composition = () =>
  readFileSync(resolve(root, "docs/video-sources/catalog-overview/index.html"), "utf8");
const page = () => readFileSync(resolve(root, "docs/catalog/index.mdx"), "utf8");

const sections = [
  "Code Animations",
  "Captions",
  "HTML-in-Canvas",
  "Social Overlays",
  "Lower Thirds",
  "Shader Transitions",
  "CSS Transitions",
  "Showcases",
  "Data",
  "Effects",
  "Blocks",
];

describe("Catalog overview montage", () => {
  test("covers every Catalog section exactly once in sidebar order", () => {
    expect(catalogOverviewAssets.map(({ section }) => section)).toEqual(sections);
    expect(new Set(catalogOverviewAssets.map(({ item }) => item)).size).toBe(sections.length);
  });

  test("mounts every frozen asset and visible section label", () => {
    const html = composition();
    for (const asset of catalogOverviewAssets) {
      expect(html).toContain(`assets/${asset.item}.mp4`);
      expect(html).toContain(`>${asset.section}<`);
    }
    expect(html).toContain('data-composition-id="catalog-overview"');
    expect(html).toContain('data-duration="19.25"');
    expect(html).toContain('data-fps="60"');
  });

  test("keeps the overview short and uses the guarded loop", () => {
    const mdx = page();
    expect(mdx).toContain(
      'import { CatalogOverviewLoop } from "/snippets/catalog-overview-loop.jsx"',
    );
    expect(mdx).toContain("<CatalogOverviewLoop");
    expect(mdx).not.toContain("## Before you keep it");
    expect(mdx).not.toContain("## Start with the job");
    expect((mdx.match(/<Card /g) ?? []).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bunx vitest run scripts/catalog-overview-video.test.ts
```

Expected: FAIL because `scripts/catalog-overview-video/assets.ts`, the composition, and the simplified MDX contract do not exist yet.

- [ ] **Step 3: Commit the red test**

```bash
git add scripts/catalog-overview-video.test.ts
git commit -S -m "test: pin Catalog overview montage contract"
```

### Task 2: Add the immutable source manifest and acquisition script

**Files:**

- Create: `scripts/catalog-overview-video/assets.ts`
- Create: `scripts/catalog-overview-video/prepare-assets.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Define the exact 11 source clips**

```ts
export const catalogOverviewAssets = [
  { section: "Code Animations", item: "code-morph", mediaStart: 1.8 },
  { section: "Captions", item: "caption-kinetic-slam", mediaStart: 1.2 },
  { section: "HTML-in-Canvas", item: "vfx-shatter", mediaStart: 1.4 },
  { section: "Social Overlays", item: "x-post", mediaStart: 1.0 },
  { section: "Lower Thirds", item: "lt-mask-reveal", mediaStart: 0.8 },
  { section: "Shader Transitions", item: "gravitational-lens", mediaStart: 1.3 },
  { section: "CSS Transitions", item: "beat-freeze-cut", mediaStart: 1.2 },
  { section: "Showcases", item: "app-showcase", mediaStart: 1.6 },
  { section: "Data", item: "world-map", mediaStart: 1.4 },
  { section: "Effects", item: "parallax-zoom", mediaStart: 1.0 },
  { section: "Blocks", item: "flowchart", mediaStart: 1.2 },
].map((asset) => ({
  ...asset,
  url: `https://static.heygen.ai/hyperframes-oss/docs/images/catalog/${
    ["caption-kinetic-slam", "parallax-zoom"].includes(asset.item) ? "components" : "blocks"
  }/${asset.item}.mp4`,
}));
```

- [ ] **Step 2: Implement deterministic acquisition**

`prepare-assets.ts` must create `docs/video-sources/catalog-overview/assets`, fetch each manifest URL with Bun, reject non-2xx responses, reject bodies under 1 KiB, write `item.mp4`, and run:

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -of json <file>
```

Require H.264 and 1920×1080 for every file. Existing files pass only after the same ffprobe validation; a partial cached download never counts.

- [ ] **Step 3: Ignore generated inputs and outputs**

Append:

```gitignore
# Catalog overview docs film — reproducible from scripts/catalog-overview-video/assets.ts
docs/video-sources/catalog-overview/assets/
docs/video-sources/catalog-overview/renders/
docs/video-sources/catalog-overview/snapshots/
docs/images/showcase/catalog-overview-v1.mp4
docs/images/showcase/catalog-overview-v1.jpg
```

- [ ] **Step 4: Run acquisition**

```bash
bun scripts/catalog-overview-video/prepare-assets.ts
```

Expected: 11 validated H.264 1920×1080 assets and no tracked binary changes.

- [ ] **Step 5: Commit the manifest and acquisition path**

```bash
git add .gitignore scripts/catalog-overview-video/assets.ts scripts/catalog-overview-video/prepare-assets.ts
git commit -S -m "build: prepare Catalog overview video assets"
```

### Task 3: Build the deterministic HyperFrames composition

**Files:**

- Create: `docs/video-sources/catalog-overview/index.html`
- Create: `docs/video-sources/catalog-overview/README.md`

- [ ] **Step 1: Author the root composition**

Create a 1920×1080 root with:

```html
<main
  id="catalog-overview"
  data-composition-id="catalog-overview"
  data-start="0"
  data-duration="19.25"
  data-fps="60"
  data-width="1920"
  data-height="1080"
>
  <!-- Eleven 1.75-second video clips and labels in manifest order. -->
</main>
```

For beat index `i`, use `data-start="i * 1.75"`, `data-duration="1.75"`, `data-media-start` from the manifest, and `data-track-index="0"` on the `<video class="clip">`. Add a matching label clip on track 1. The label uses the exact section text, a dark translucent pill, 64 px safe-area offsets, and no entrance/exit fade. Use `object-fit: cover`; never stretch source media.

- [ ] **Step 2: Document the reproducible commands**

`README.md` contains these exact commands:

```bash
bun scripts/catalog-overview-video/prepare-assets.ts
npx hyperframes@0.7.107 lint docs/video-sources/catalog-overview
npx hyperframes@0.7.107 check docs/video-sources/catalog-overview --at-transitions --snapshots
npx hyperframes@0.7.107 render docs/video-sources/catalog-overview \
  --fps 60 --quality high --workers 1 --strict \
  --output docs/video-sources/catalog-overview/renders/catalog-overview-v1.mp4
```

- [ ] **Step 3: Run the contract test and verify partial GREEN**

```bash
bunx vitest run scripts/catalog-overview-video.test.ts
```

Expected: the composition assertions pass; the page assertions still fail.

- [ ] **Step 4: Run HyperFrames gates**

```bash
npx hyperframes@0.7.107 lint docs/video-sources/catalog-overview
npx hyperframes@0.7.107 check docs/video-sources/catalog-overview --at-transitions --snapshots
```

Expected: zero errors and no warnings that affect visibility, timing, media readiness, or contrast.

- [ ] **Step 5: Commit the source project**

```bash
git add docs/video-sources/catalog-overview
git commit -S -m "feat: build Catalog overview montage"
```

### Task 4: Add the reduced-motion-safe Mintlify loop

**Files:**

- Create: `docs/snippets/catalog-overview-loop.jsx`

- [ ] **Step 1: Implement the focused loop component**

The named export accepts `src`, `poster`, and `title`. It reads
`prefers-reduced-motion` inside a `useState` lazy initializer, subscribes to
preference changes, and when reduction turns on calls `pause()`,
`removeAttribute("src")`, and `load()` on the video. Render:

```jsx
<video
  ref={videoRef}
  aria-label={title}
  src={reduced ? undefined : src}
  poster={poster}
  autoPlay={!reduced}
  muted
  loop={!reduced}
  playsInline
  preload="metadata"
  className="aspect-video w-full rounded-xl bg-zinc-950 object-cover"
/>
```

Do not add controls, sound state, a dependency, or a custom player.

- [ ] **Step 2: Run the repository autoplay invariant**

```bash
bun run check:docs-snippet-motion
```

Expected: PASS, including the new component.

- [ ] **Step 3: Commit the snippet**

```bash
git add docs/snippets/catalog-overview-loop.jsx
git commit -S -m "feat(docs): add Catalog overview preview loop"
```

### Task 5: Render, inspect, and publish the media

**Files:**

- Generate local-only: `docs/video-sources/catalog-overview/renders/catalog-overview-v1.mp4`
- Generate local-only: `docs/images/showcase/catalog-overview-v1.mp4`
- Generate local-only: `docs/images/showcase/catalog-overview-v1.jpg`
- Generate evidence: contact sheet under `/tmp/catalog-overview-proof/`

- [ ] **Step 1: Render at true 60 fps**

```bash
npx hyperframes@0.7.107 render docs/video-sources/catalog-overview \
  --fps 60 --quality high --workers 1 --strict \
  --output docs/video-sources/catalog-overview/renders/catalog-overview-v1.mp4
```

- [ ] **Step 2: Verify the encoded artifact**

Use ffprobe to require H.264, 1920×1080, `60/1`, 1155 frames, and 19.25 seconds. Decode the full file with:

```bash
ffmpeg -v error -i docs/video-sources/catalog-overview/renders/catalog-overview-v1.mp4 -f null -
```

Generate 11 evenly spaced proof frames and a labeled contact sheet. Verify every exact section label appears once and adjacent beats are visually distinct.

- [ ] **Step 3: Create the poster and stage CDN files**

```bash
mkdir -p docs/images/showcase
cp docs/video-sources/catalog-overview/renders/catalog-overview-v1.mp4 \
  docs/images/showcase/catalog-overview-v1.mp4
ffmpeg -y -ss 0.8 -i docs/images/showcase/catalog-overview-v1.mp4 \
  -frames:v 1 docs/images/showcase/catalog-overview-v1.jpg
```

- [ ] **Step 4: Upload through the established docs workflow**

```bash
bash scripts/upload-docs-images.sh
```

Expected: S3 sync succeeds and CloudFront returns an invalidation ID.

- [ ] **Step 5: Verify both immutable CDN URLs**

```bash
curl -fsSI https://static.heygen.ai/hyperframes-oss/docs/images/showcase/catalog-overview-v1.mp4
curl -fsSI https://static.heygen.ai/hyperframes-oss/docs/images/showcase/catalog-overview-v1.jpg
```

Expected: HTTP 200 and correct `video/mp4` / `image/jpeg` content types.

### Task 6: Simplify the Catalog overview page

**Files:**

- Modify: `docs/catalog/index.mdx`

- [ ] **Step 1: Replace the dense body with the approved structure**

Import `CatalogOverviewLoop`, then render it directly after the opening sentence using:

```mdx
<CatalogOverviewLoop
  title="A fast tour of every HyperFrames Catalog section"
  src="https://static.heygen.ai/hyperframes-oss/docs/images/showcase/catalog-overview-v1.mp4"
  poster="https://static.heygen.ai/hyperframes-oss/docs/images/showcase/catalog-overview-v1.jpg"
/>
```

Follow it with exactly two destination cards: **Blocks** links to
`/catalog/blocks/app-showcase`, and **Components** links to
`/catalog/components/caption-kinetic-slam`. Add a three-item ordered list under
`## Use an item`, one compact sentence naming all 11 sections for non-video
access, and the three existing related links. Remove the six job cards, the
six-step workflow, and the entire quality checklist.

- [ ] **Step 2: Run the contract suite and verify GREEN**

```bash
bunx vitest run scripts/catalog-overview-video.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 3: Format and validate docs**

```bash
bunx oxfmt docs/catalog/index.mdx docs/snippets/catalog-overview-loop.jsx \
  scripts/catalog-overview-video.test.ts scripts/catalog-overview-video/*.ts
mint validate
mint broken-links
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit the page**

```bash
git add docs/catalog/index.mdx docs/snippets/catalog-overview-loop.jsx \
  scripts/catalog-overview-video.test.ts scripts/catalog-overview-video
git commit -S -m "docs: simplify the Catalog overview"
```

### Task 7: Run local Mintlify and capture the exact route

**Files:**

- Generate evidence under `/tmp/catalog-overview-proof/`

- [ ] **Step 1: Start Mintlify from the docs directory**

```bash
cd docs
mint dev --port 3333
```

Keep the server in a task-owned background session and record its PID/session.

- [ ] **Step 2: Reproduce the exact public route locally**

Open `http://127.0.0.1:3333/catalog` in a browser. Verify:

- the first paint contains the opening sentence, poster/video, and two cards;
- the loop plays silently and reaches all 11 labeled beats;
- desktop and narrow widths do not overflow;
- dark mode remains readable;
- with reduced motion enabled, the video stops and the poster remains;
- both cards and all three related links navigate to existing pages.

- [ ] **Step 3: Capture proof**

Save at least:

- `/tmp/catalog-overview-proof/catalog-desktop.png`
- `/tmp/catalog-overview-proof/catalog-narrow.png`
- `/tmp/catalog-overview-proof/catalog-dark.png`
- `/tmp/catalog-overview-proof/catalog-contact-sheet.png`

- [ ] **Step 4: Stop the local browser/server**

Terminate only task-owned processes and confirm port 3333 is free.

### Task 8: Final verification, PR, and private handoff

**Files:**

- Verify all changed tracked files and generated proof.

- [ ] **Step 1: Run the final fail-closed suite**

```bash
bunx vitest run scripts/catalog-overview-video.test.ts
bun run check:docs-snippet-motion
bun run test:scripts
bunx oxfmt --check docs/catalog/index.mdx docs/snippets/catalog-overview-loop.jsx \
  docs/video-sources/catalog-overview scripts/catalog-overview-video* \
  plans/catalog-overview-video-*.md
mint validate
mint broken-links
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Verify repository state and signatures**

Require a clean worktree after the final commit, verify every task commit contains an SSH signature, and confirm no generated MP4/JPG or downloaded source assets are tracked.

- [ ] **Step 3: Push and open the PR**

Push `docs/catalog-overview-video`, open a PR against `main`, include the exact test commands, CDN URLs, and screenshot proof, and do not merge without Miguel's explicit instruction.

- [ ] **Step 4: Send the private Slack handoff**

Upload the desktop, narrow, dark, and contact-sheet images to Miguel's DM thread
`D0B20DH4DUH` / `1786477792.877569`, then post the PR link and concise proof:
video codec/fps/duration/frame count, HyperFrames checks, Mintlify validation,
local-route coverage, and worktree status.

- [ ] **Step 5: Retire or touch the worktree**

If the PR is still open, run:

```bash
worktree-lifecycle touch /home/ubuntu/.config/superpowers/worktrees/hyperframes-oss/catalog-overview-video
```

State that it remains for review. If merged and clean, retire it instead.
