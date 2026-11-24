<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo/dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/logo/light.svg">
    <img alt="HyperFrames" src="docs/logo/light.svg" width="300">
  </picture>
</p>

<p align="center">
  <a href="https://skills.sh/heygen-com/hyperframes"><img src="https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fskills.sh%2Fapi%2Fbadge%2Fheygen-com%2Fhyperframes" alt="Skills downloads"></a>
  <a href="https://www.star-history.com/heygen-com/hyperframes"><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/badge?repo=heygen-com/hyperframes&type=rank&theme=dark"><img alt="GitHub top repository global rank" src="https://api.star-history.com/badge?repo=heygen-com/hyperframes&type=rank" height="36"></picture></a>
  <a href="https://www.npmjs.com/package/hyperframes"><img src="https://img.shields.io/npm/v/hyperframes.svg?style=flat" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/hyperframes"><img src="https://img.shields.io/npm/dm/hyperframes.svg?style=flat" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node.js"></a>
  <a href="https://discord.gg/fzbdWyjphr"><img src="https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align="center"><b>The open-source AI video editor: create, edit, remake.</b></p>

<p align="center">Write HTML. Render video. Built for agents.</p>

<p align="center">
  <a href="https://hyperframes.studio/studio/download?utm_source=github&utm_medium=readme&src=github-readme">Download the app</a> ·
  <a href="https://hyperframes.heygen.com/quickstart?utm_source=github&utm_medium=readme">Quickstart</a> ·
  <a href="https://hyperframes.heygen.com/examples?utm_source=github&utm_medium=readme">Showcase</a> ·
  <a href="https://hyperframes.heygen.com/catalog/blocks/data-chart?utm_source=github&utm_medium=readme">Catalog</a> ·
  <a href="https://hyperframes.heygen.com/introduction?utm_source=github&utm_medium=readme">Docs</a> ·
  <a href="https://discord.gg/fzbdWyjphr">Discord</a> ·
  <a href="https://x.com/HyperFrames_">X</a> ·
  <a href="https://www.youtube.com/@HyperFrames_Official">YouTube</a>
</p>

<p align="center"><a href="https://hyperframes.studio/studio/download?src=github-readme-hero"><picture><source type="image/avif" srcset="https://static.heygen.ai/hyperframes-oss/readme/2026-11/hero-studio-intro-26s-v3.avif"><img src="https://static.heygen.ai/hyperframes-oss/readme/2026-11/hero-studio-intro-v1.webp" width="800" alt="HyperFrames Studio, the AI video editor: ask for a launch video, get an editable project, then mark one word and the agent changes just that"></picture></a></p>

HyperFrames is HeyGen's AI video editor for people and agents. Describe a video, bring your own footage, or remake a video you love, and get a real project you can change down to the frame: ask for a bigger title, a faster cut or new captions, and it changes just that.

Underneath, HyperFrames is a free, open-source framework (Apache 2.0) for turning HTML, CSS, JavaScript, media and seekable animations into deterministic MP4 videos. Use it locally with the CLI, from AI coding agents like Claude Code, Codex and Cursor with skills, or as the rendering core behind hosted authoring workflows. No React required.

## Three ways to use it

|                                    | Best for                                                                                                                                                     | Start                                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HyperFrames Studio app**         | Anyone, no code. Describe a video or drop in your footage, then edit by typing or pointing. Use the built-in agent on Pro, or your own Claude Code or Codex. | [Download for Mac, Windows or Linux](https://hyperframes.studio/studio/download?src=github-readme) (free plan)                                                                                             |
| **Your coding agent**              | Claude Code, Codex, Cursor, Gemini CLI and other agents.                                                                                                     | `npx skills add heygen-com/hyperframes`                                                                                                                                                                    |
| **Claude, ChatGPT or Grok** (beta) | Making a video in a chat, nothing to install. ChatGPT: Business, Enterprise and Edu workspaces.                                                              | Connect [HyperFrames by HeyGen](https://hyperframes.heygen.com/guides/mcp?utm_source=github&utm_medium=readme), listed in [Claude's connector directory](https://claude.com/connectors/hyperframes-heygen) |

The [HyperFrames Studio app](https://hyperframes.studio/studio?utm_source=github&utm_medium=readme) has a free plan. [Pro](https://hyperframes.studio/pricing?utm_source=github&utm_medium=readme) ($25 a month) adds top video, image, voice and music models (HeyGen Video 1, Seedance 2.5, Lyria 3 Pro and more) and 25,000 credits a month.

## Made with HyperFrames

<table>
<tr><td align="center" valign="bottom"><a href="https://x.com/HyperFrames_/status/2113670541274144802"><img src="https://static.heygen.ai/hyperframes-oss/readme/2026-11/script-based-editing-v1.webp" width="195" alt="Editing a talking-head video by editing its script in HyperFrames Studio"></a><br><b>Script-based editing</b></td><td align="center" valign="bottom"><a href="https://x.com/liu8in/status/2123562606535565629"><img src="https://static.heygen.ai/hyperframes-oss/readme/2026-11/edit-your-own-footage-v1.webp" width="195" alt="A creator's own phone footage edited into a finished social video with HyperFrames"></a><br><b>Edit your own footage</b></td><td align="center" valign="bottom"><a href="https://x.com/HyperFrames_/status/2112960682526490691"><img src="https://static.heygen.ai/hyperframes-oss/readme/2026-11/captions-v1.webp" width="195" alt="Animated captions added to a talking-head video with HyperFrames"></a><br><b>Captions on your video</b></td><td align="center" valign="bottom"><a href="https://x.com/HyperFrames_/status/2110784695634178256"><img src="https://static.heygen.ai/hyperframes-oss/readme/2026-11/remake-any-video-v1.webp" width="195" alt="A video rebuilt as an editable HyperFrames project, then changed"></a><br><b>Remake any video</b></td></tr>
<tr><td align="center" valign="bottom"><a href="https://static.heygen.ai/hyperframes-oss/homepage/showcase/hq/website-to-launch-v1.mp4"><img src="https://static.heygen.ai/hyperframes-oss/readme/2026-11/launch-from-website-v1.webp" width="195" alt="Product launch video built from a company's website with HyperFrames"></a><br><b>Launch video from your website</b></td><td align="center" valign="bottom"><a href="https://x.com/WaterrrMiao/status/2114585876160455057"><img src="https://static.heygen.ai/hyperframes-oss/readme/2026-11/faceless-explainer-v1.webp" width="195" alt="Faceless YouTube explainer made with HyperFrames"></a><br><b>Faceless explainer</b></td><td align="center" valign="bottom"><a href="https://static.heygen.ai/hyperframes-oss/readme/2026-11/films/flat-cartoon-explainer-v1.mp4"><img src="https://static.heygen.ai/hyperframes-oss/readme/2026-11/flat-cartoon-explainer-v1.webp" width="195" alt="Flat cartoon explainer video about the Sun made with HyperFrames"></a><br><b>Flat cartoon explainer</b></td><td align="center" valign="bottom"><a href="https://static.heygen.ai/hyperframes-oss/homepage/showcase/hq/real-ui-newspaper-1969-v2.mp4"><img src="https://static.heygen.ai/hyperframes-oss/readme/2026-11/real-ui-newspaper-v1.webp" width="195" alt="Motion graphics built from a real 1969 newspaper front page with HyperFrames"></a><br><b>Real-UI motion graphics</b></td></tr>
<tr><td align="center" valign="bottom"><a href="https://static.heygen.ai/hyperframes-oss/homepage/showcase/hq/cartoon-frameys-launch-one-take-v1.mp4"><img src="https://static.heygen.ai/hyperframes-oss/readme/2026-11/3d-one-take-trailer-v1.webp" width="195" alt="3D one-take launch trailer made with HyperFrames"></a><br><b>3D one-take trailer</b></td><td align="center" valign="bottom"><a href="https://static.heygen.ai/hyperframes-oss/readme/2026-11/films/3d-type-v1.mp4"><img src="https://static.heygen.ai/hyperframes-oss/readme/2026-11/3d-type-v1.webp" width="195" alt="Kinetic 3D typography made with HyperFrames"></a><br><b>3D type</b></td><td align="center" valign="bottom"><a href="https://static.heygen.ai/hyperframes-oss/homepage/showcase/hq/remotion-to-hyperframes-v1.mp4"><img src="https://static.heygen.ai/hyperframes-oss/readme/2026-11/remotion-ported-voxels-v1.webp" width="195" alt="A Remotion project with 3D voxels, ported to HyperFrames"></a><br><b>Remotion project, ported</b></td><td align="center" valign="bottom"><a href="https://static.heygen.ai/hyperframes-oss/homepage/showcase/hq/generative-replica-v1.mp4"><img src="https://static.heygen.ai/hyperframes-oss/readme/2026-11/generative-motion-v1.webp" width="195" alt="Generative motion design made with HyperFrames"></a><br><b>Generative motion</b></td></tr>
</table>

Click any clip to watch it with sound.

## What you can make

| Video                                                                                                                     | How                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branded UGC videos for TikTok and Instagram from your own phone clips: captions, music, text hooks, fast client revisions | The Studio app: drop in your footage, then edit by typing or pointing                                                                                 |
| Video podcast episodes: line up a multi-camera recording, cut to whoever is talking, clean up the sound, add captions     | The Studio app's podcast edit                                                                                                                         |
| Product demos, tutorials, launch videos and feature announcements, from your website or a screen recording                | Paste your URL into the Studio app, or ask your agent                                                                                                 |
| Explainer and faceless YouTube episodes from your topic, script or voiceover                                              | Ask for one; [`/style-sampling`](skills/style-sampling) for five proven series styles                                                                 |
| Remake a video you love, then make it yours                                                                               | [`/reverse-any-video`](skills/reverse-any-video)                                                                                                      |
| Social videos with kinetic captions, overlays, and music                                                                  | [`/hyperframes`](skills/hyperframes) with the [catalog](https://hyperframes.heygen.com/catalog/blocks/data-chart?utm_source=github&utm_medium=readme) |
| Data visualizations, chart races, and map animations                                                                      | Catalog blocks for charts and maps                                                                                                                    |
| PR walkthroughs and changelog videos with animated code diffs, narration, and captions                                    | Point your agent at the pull request                                                                                                                  |
| Docs-to-video and site-tour explainers                                                                                    | Give your agent the document or link                                                                                                                  |
| Motion graphics with code instead of After Effects, reusable in automated content pipelines                               | The CLI, cloud render or AWS Lambda                                                                                                                   |
| Decks with presenter mode                                                                                                 | [`/slideshow`](skills/slideshow)                                                                                                                      |
| Motion from a Figma file                                                                                                  | [`/figma`](skills/figma)                                                                                                                              |
| A Remotion project, ported                                                                                                | [`/remotion-to-hyperframes`](skills/remotion-to-hyperframes)                                                                                          |

By job: [AI video editor](https://hyperframes.heygen.com/tools/ai-video-editor?utm_source=github&utm_medium=readme) · [animated captions](https://hyperframes.heygen.com/tools/animated-captions?utm_source=github&utm_medium=readme) · [add text to video](https://hyperframes.heygen.com/tools/add-text-to-video?utm_source=github&utm_medium=readme) · [AI motion graphics](https://hyperframes.heygen.com/tools/ai-motion-graphics?utm_source=github&utm_medium=readme) · [HTML to MP4](https://hyperframes.heygen.com/tools/html-to-video?utm_source=github&utm_medium=readme) · [Lottie to MP4](https://hyperframes.heygen.com/tools/lottie-to-mp4?utm_source=github&utm_medium=readme) · [SVG to MP4](https://hyperframes.heygen.com/tools/svg-animation-to-mp4?utm_source=github&utm_medium=readme)

**Community skills** ([hyperframes-community-skills](https://github.com/heygen-com/hyperframes-community-skills), community-maintained, review before use): `camera-3d-captions` (captions in 3D around a speaker), `vox-explainer` (collage explainers), `p5-paint-animation` (handwriting and paint-on), `prod-by-claude` (live-coded music videos), `session-story` and `day-in-my-life` (your agent sessions as films), `duo` (side-by-side phone memes), `x-posting-license` (an ID-card video for any X profile).

## Quick start for developers

Using Claude Code, Codex, Cursor, or another coding agent? Install the skills once, then ask your agent to make a video.

### Give your coding agent the skills (recommended)

```bash
npx skills add heygen-com/hyperframes     # pick "Core Skills" in the picker
# or, with no picker (scripts, CI):
npx hyperframes skills update
```

Then try: _Using `/hyperframes`, create a 10-second product intro with a fade-in title, a background video, and subtle background music._

### Claude Code plugin

```bash
claude plugin marketplace add heygen-com/hyperframes
claude plugin install hyperframes@hyperframes
```

### Codex, Cursor, Gemini CLI, Copilot

See the [plugin guide](https://hyperframes.heygen.com/guides/plugins?utm_source=github&utm_medium=readme).

### By hand, with the CLI

```bash
npx hyperframes init my-video
cd my-video
npx hyperframes preview      # live preview in the browser
npx hyperframes render       # render to MP4
```

Requirements: Node.js 22+ and FFmpeg. Render in the cloud with `hyperframes cloud render`, or on your own [AWS Lambda](https://hyperframes.heygen.com/deploy/aws-lambda?utm_source=github&utm_medium=readme).

<details>
<summary>Skill install options, updates and the core set (full details)</summary>

### Claude Code plugin updates

To enable auto-update for the **hyperframes** marketplace, run `claude` in a
terminal in your project. In Claude Code's terminal UI, run `/plugin`, then select
**Marketplaces** → **hyperframes** → **Enable auto-update**. Afterward, use
`/hyperframes:hyperframes`. See the [plugin guide](docs/guides/plugins.mdx)
for Copilot, VS Code, Cursor, Gemini CLI, updates, and migration.

### Standalone skills (including OpenCode)

> The picker opens with nothing pre-selected — the **Core Skills** group is all you need; `/slideshow`, `/remotion-to-hyperframes` and `/figma` install on demand. Without the picker (a script or a CI job), `npx hyperframes skills update` installs exactly the core set, whereas `skills add --all` installs all 9 published skills. The six repo-internal skills under `.claude/skills` / `.agents/skills` are excluded by default. For the full published set use `npx hyperframes skills`.
>
> `skills add` resolves the skills.sh registry blob, which can lag `main` by hours. `npx hyperframes skills update` installs the skills from the release tag that matches your CLI version, so they match the CLI that runs them.

Run project-local installs from your video project's directory. From a HyperFrames
checkout, use `npx hyperframes skills update` for a global install instead: a
project-local installer target can overlap the tracked `skills/` source and
overwrite uncommitted edits. See [contributor setup](CONTRIBUTING.md#getting-started).

</details>

The skills teach agents the HyperFrames production loop: plan the video, write valid HTML, wire seekable animations, add media, lint, preview, and render. They work with Claude Code, Codex, Cursor, Gemini CLI, IBM Bob, and other coding agents that support skills.

### Share a video for review

Sign in with `npx hyperframes auth login`, then run `npx hyperframes share` to
choose who can open the rendered review. Use `share --update` when edits should
become a new version and `share --manage` for web settings. CLI and Desktop use
the same sharing system and five free projects per workspace. Existing legacy
published links remain reachable.

## Skills

HyperFrames ships 9 skills. Make any video by asking for it; the `/hyperframes` skill carries the contract and the references (film, captions, overlays, motion, look). Read it first.

The **core set** below is what `npx hyperframes skills update` installs and what the picker lists as "Core Skills". Install one skill with `npx skills add heygen-com/hyperframes --skill <name>`, or all 9 with `--all`. A non-interactive or agent run of `npx skills add` without `--skill` installs all 9. `npx hyperframes init` adds the core set only when it is missing and never touches a skill you already have; on-demand skills install with `npx hyperframes skills update <name>`.

### Core set

| Skill                   | Use when                                                                                                                                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/hyperframes`          | **Read first** for any request to make, edit, animate or render a video, motion graphic, captions or overlays with HyperFrames (HTML rendered to video). Holds the render contract and the work loop, and points to the references for format, motion, look, captions, whole films and storyboards. |
| `/hyperframes-cli`      | The HyperFrames CLI by job — scaffold, check, look at frames, edit the timeline, preview, render locally or in the cloud, share, project history — plus reading its JSON and recovering from build or render failures.                                                                              |
| `/hyperframes-registry` | About 450 ready-made blocks and components installed as editable source — transitions, overlays, titles, kinetic type, captions, charts, maps, 3D, camera moves. Use before hand-building any named visual; also for `hyperframes add` and `catalog`.                                               |
| `/media-use`            | Get or make any media for a video — music, sound effects, images, icons, logos, voiceover, avatar and generated video, transcripts, cutouts, colour grades and looks — with HeyGen or free local tools, and mix placed audio. Also for footage that looks dark, flat or dull.                       |
| `/reverse-any-video`    | Rebuilding any video file as an editable HyperFrames project (motion graphics, talking heads, live action, AI-generated footage), checked frame by frame against the original.                                                                                                                      |
| `/style-sampling`       | Making a new episode on your topic in one of five proven styles: Collage Explainer, Finance Explainer, Animated Science Explainer, 3D Brand Explainer, 3D True Crime.                                                                                                                               |

### On demand

| Skill                      | Use when                                                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/figma`                   | Bring Figma into a video — rendered assets, brand tokens, components, storyboard frames as reconstructed motion, shaders and connector-assisted motion. Use when you paste a figma.com link.          |
| `/slideshow`               | A presentation, pitch deck or interactive deck — discrete slides, fragment reveals, branching, hotspot navigation, presenter mode with speaker notes. Output is a navigable deck, not a rendered MP4. |
| `/remotion-to-hyperframes` | Bringing existing video code or footage into HyperFrames (Remotion first; also Motion Canvas, Lottie, Three.js, canvas, other tools' renders), verified frame by frame.                               |

For visual design handoff workflows, see the [Claude Design guide](https://hyperframes.heygen.com/guides/design-tools?utm_source=github&utm_medium=readme#start-from-claude-design-or-open-design) and [Open Design guide](https://hyperframes.heygen.com/guides/design-tools?utm_source=github&utm_medium=readme#start-from-claude-design-or-open-design).

More from the community: [hyperframes-community-skills](https://github.com/heygen-com/hyperframes-community-skills).

## Frame.md

**frame.md — your design system, ready for video.**

Every brand has a `design.md`. None of them were written for a camera. `frame.md` is the missing translation layer: it takes your web-context design spec and inverts it for the frame — the same tokens, the same rules, but rewritten so an AI agent can compose a promo video without guessing at scale or reaching for web chrome.

The output is a `DESIGN.md` superset your whole toolchain can read. Atoms stay sacred. Composition stays free. Numbers come from the script.

<table>
  <tr>
    <td width="50%" align="center">
      <a href="https://hyperframes.studio/design/biennale-yellow?utm_source=github&utm_medium=readme"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/biennale-yellow.png" alt="Biennale Yellow" width="100%"></a>
      <br><b><a href="https://hyperframes.studio/design/biennale-yellow?utm_source=github&utm_medium=readme">Biennale Yellow</a></b>
    </td>
    <td width="50%" align="center">
      <a href="https://hyperframes.studio/design/blockframe?utm_source=github&utm_medium=readme"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/blockframe.png" alt="BlockFrame" width="100%"></a>
      <br><b><a href="https://hyperframes.studio/design/blockframe?utm_source=github&utm_medium=readme">BlockFrame</a></b>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="https://hyperframes.studio/design/blue-professional?utm_source=github&utm_medium=readme"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/blue-professional.png" alt="Blue Professional" width="100%"></a>
      <br><b><a href="https://hyperframes.studio/design/blue-professional?utm_source=github&utm_medium=readme">Blue Professional</a></b>
    </td>
    <td width="50%" align="center">
      <a href="https://hyperframes.studio/design/bold-poster?utm_source=github&utm_medium=readme"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/bold-poster.png" alt="Bold Poster" width="100%"></a>
      <br><b><a href="https://hyperframes.studio/design/bold-poster?utm_source=github&utm_medium=readme">Bold Poster</a></b>
    </td>
  </tr>
</table>

Browse and remix them all at [hyperframes.studio/design](https://hyperframes.studio/design?utm_source=github&utm_medium=readme).

## How It Works

Define a video as HTML. Add data attributes for timing and tracks. Use GSAP, CSS, Lottie, Three.js, Anime.js, WAAPI, or your own frame adapter for seekable animation.

```html
<div id="stage" data-composition-id="launch" data-start="0" data-width="1920" data-height="1080">
  <video
    class="clip"
    data-start="0"
    data-duration="6"
    data-track-index="0"
    src="intro.mp4"
    muted
    playsinline
  ></video>

  <h1 id="title" class="clip" data-start="1" data-duration="4" data-track-index="1">Launch day</h1>

  <audio
    data-start="0"
    data-duration="6"
    data-track-index="2"
    data-volume="0.5"
    src="music.wav"
  ></audio>

  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.from("#title", { opacity: 0, y: 40, duration: 0.8 }, 1);
    window.__timelines = window.__timelines || {};
    window.__timelines.launch = tl;
  </script>
</div>
```

Preview instantly in the browser. Render locally or in Docker. The renderer seeks each frame in headless Chrome and encodes the result with FFmpeg, so the same input produces the same video.

## Why HyperFrames?

- **HTML-native:** make videos programmatically with HTML, CSS and JavaScript; compositions are HTML files with data attributes. No React requirement, no proprietary timeline format.
- **Agent-friendly:** agents already write HTML, and the CLI is non-interactive by default.
- **Deterministic:** same input, same frames, same output. Built for CI, regression tests, and automated rendering.
- **No build step:** an `index.html` composition plays as-is and can be previewed directly in the browser.
- **Adapter-based animation:** bring GSAP, CSS animations, Lottie, Three.js, Anime.js, WAAPI, or a custom runtime.
- **Open source:** Apache 2.0 license, with no per-render fees or commercial-use thresholds.

## HyperFrames vs Remotion

HyperFrames is inspired by [Remotion](https://www.remotion.dev). Both tools render video with headless Chrome and FFmpeg. The main difference is the authoring model: Remotion's bet is React components; HyperFrames' bet is plain HTML that humans and agents can both write easily.

|                          | **HyperFrames**                       | **Remotion**                            |
| ------------------------ | ------------------------------------- | --------------------------------------- |
| Authoring                | HTML + CSS + seekable animation       | React components                        |
| Build step               | None; `index.html` plays as-is        | Bundler required                        |
| Agent handoff            | Plain HTML files                      | JSX / React project                     |
| Library-clock animations | Seekable, frame-accurate via adapters | Wall-clock animation patterns need care |
| Distributed rendering    | Local and AWS Lambda render paths     | Remotion Lambda, mature cloud renderer  |
| License                  | Apache 2.0                            | Source-available Remotion License       |

Read the full comparison in the [HyperFrames vs Remotion guide](https://hyperframes.heygen.com/guides/hyperframes-vs-remotion?utm_source=github&utm_medium=readme), or the [side-by-side comparison page](https://hyperframes.heygen.com/vs/remotion?utm_source=github&utm_medium=readme).

## Catalog

Install ready-to-use blocks and components:

```bash
npx hyperframes add flash-through-white   # shader transition
npx hyperframes add instagram-follow      # social overlay
npx hyperframes add data-chart            # animated chart
```

Browse the catalog at [hyperframes.heygen.com/catalog](https://hyperframes.heygen.com/catalog/blocks/data-chart?utm_source=github&utm_medium=readme).

## HyperFrames Stack

HyperFrames is the open-source rendering engine, plus a growing set of tools around HTML-native video creation.

| Piece                                                                                 | Status              | What it does                                                                                    |
| ------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| CLI                                                                                   | Available           | Scaffold, preview, lint, inspect, and render local video projects                               |
| Core / Engine / Producer                                                              | Available           | Parse compositions, drive headless Chrome, encode video, and mix audio                          |
| Catalog                                                                               | Available           | Reusable blocks and components for transitions, overlays, captions, charts, maps, and effects   |
| Agent skills                                                                          | Available           | Teach coding agents the video-production patterns that generic web docs miss                    |
| Browser editor (`hyperframes preview`)                                                | Available, evolving | Preview and edit compositions in the browser: canvas, timeline, keyframes                       |
| AWS Lambda rendering                                                                  | Available           | Deploy a distributed render stack and drive renders from your laptop or CI                      |
| [hyperframes.studio](https://hyperframes.studio/?utm_source=github&utm_medium=readme) | Available           | The HyperFrames Studio app for Mac, Windows and Linux, plans and community                      |
| [frame.md](https://hyperframes.studio/design?utm_source=github&utm_medium=readme)     | Available           | Invert your design system for the camera — a DESIGN.md superset an agent can compose video from |

## Packages

| Package                                                          | Description                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`hyperframes`](packages/cli)                                    | CLI for creating, previewing, linting, and rendering compositions |
| [`@hyperframes/core`](packages/core)                             | Types, parsers, generators, linter, runtime, and frame adapters   |
| [`@hyperframes/engine`](packages/engine)                         | Seekable page-to-video capture engine using Puppeteer and FFmpeg  |
| [`@hyperframes/producer`](packages/producer)                     | Full rendering pipeline for capture, encode, and audio mix        |
| [`@hyperframes/studio`](packages/studio)                         | Browser-based composition editor UI                               |
| [`@hyperframes/player`](packages/player)                         | Embeddable `<hyperframes-player>` web component                   |
| [`@hyperframes/shader-transitions`](packages/shader-transitions) | WebGL shader transitions for compositions                         |
| [`@hyperframes/aws-lambda`](packages/aws-lambda)                 | AWS Lambda SDK and deployment surface for distributed renders     |

## Documentation

Full documentation: [hyperframes.heygen.com/introduction](https://hyperframes.heygen.com/introduction?utm_source=github&utm_medium=readme)

- [Quickstart](https://hyperframes.heygen.com/quickstart?utm_source=github&utm_medium=readme)
- [Showcase](https://hyperframes.heygen.com/examples?utm_source=github&utm_medium=readme)
- [Guides](https://hyperframes.heygen.com/guides/gsap-animation?utm_source=github&utm_medium=readme)
- [API Reference](https://hyperframes.heygen.com/packages/core?utm_source=github&utm_medium=readme)
- [Catalog](https://hyperframes.heygen.com/catalog/blocks/data-chart?utm_source=github&utm_medium=readme)
- [Examples](https://hyperframes.heygen.com/examples?utm_source=github&utm_medium=readme)
- [AWS Lambda rendering](https://hyperframes.heygen.com/deploy/aws-lambda?utm_source=github&utm_medium=readme)

## Community

HyperFrames is used in production at [HeyGen](https://www.heygen.com?utm_source=github&utm_medium=readme), with community examples from teams like [tldraw](https://tldraw.com), [TanStack](https://tanstack.com), and others in [ADOPTERS.md](ADOPTERS.md). Open a PR if your team is using HyperFrames.

- Questions and ideas: [Discord](https://discord.gg/fzbdWyjphr)
- Bugs and feature requests: [GitHub Issues](https://github.com/heygen-com/hyperframes/issues)
- User research: [Book a casual 30-minute conversation with the HyperFrames team](https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ2cSpKoDgmcmRrgekrnrgqmvPT8W6F2Zg6e7MY7IJqaZKwpn_I0NdTHkN390iguMepE_NVg8ezb?gv=true) — no preparation or sales pitch
- Security reports: [SECURITY.md](SECURITY.md)
- Contributions: [CONTRIBUTING.md](CONTRIBUTING.md)
- Follow along: [X](https://x.com/HyperFrames_) · [YouTube](https://www.youtube.com/@HyperFrames_Official)

[![Star History Chart](https://api.star-history.com/svg?repos=heygen-com/hyperframes&type=Date)](https://www.star-history.com/#heygen-com/hyperframes&Date)

## Development Note

The repo uses [Git LFS](https://git-lfs.com) for golden regression-test baselines under `packages/producer/tests/**/output.mp4` (about 240 MB of `.mp4` files). If you're cloning the full repo for development, install Git LFS first:

```bash
# macOS
brew install git-lfs

# Ubuntu / Debian
sudo apt install git-lfs

# Windows
winget install GitHub.GitLFS

# Then, once per machine
git lfs install
```

If you only need source files, you can skip LFS content:

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/heygen-com/hyperframes.git
```

## License

[Apache 2.0](LICENSE)
