---
name: import-timeline
description: Start a HyperFrames project from an editing timeline - OpenTimelineIO (.otio) or any editor format OTIO can read (EDL, Final Cut XML). Flatten it with the official OpenTimelineIO Python package, then run hyperframes init --timeline. Use to import, convert or render an edit made in another editor.
---

**Plugin installs:** Inside a HyperFrames plugin, follow [plugin execution rules](../hyperframes/references/plugin-installation.md).

**Usage beacon:** run `npx hyperframes events --skill=import-timeline` once as this skill starts. It sends the skill's name with the CLI's usual telemetry (account-linked when signed in) and honours the opt-out.

# Import an editing timeline

OpenTimelineIO (OTIO) does the parsing and time math; HyperFrames lays out what it reports. Never parse `.otio`, EDL or XML by hand.

## 1. Flatten

Install OTIO once, in a venv (the person's step):

```bash
uv venv ~/.venvs/otio && VIRTUAL_ENV=~/.venvs/otio uv pip install opentimelineio
```

`.otio` reads as is. Other formats need their adapter in the same venv, and the file's extension picks it (`--adapter` names one): EDL `otio-cmx3600-adapter`, Final Cut Pro 7 XML `otio-fcp-adapter`, Final Cut Pro X `otio-fcpx-xml-adapter`, GStreamer `otio-xges-adapter`. These four are tested. AAF (`otio-aaf-adapter`) reads, but carries no media: relink it first with `otiotool --relink-by-name <media folders> -o relinked.otio` (see the guide). Clip lists such as ALE logs have no edit and are refused.

```bash
~/.venvs/otio/bin/python -I scripts/otio_flatten.py cut.otio --width 1920 --height 1080 > timeline.json
```

OTIO carries no canvas size: take `--width`/`--height` from the person or `ffprobe`, else it is 1920x1080. Read `warnings` in the JSON first: offline clips, unreconciled source timecode, mixed frame rates.

## 2. Build

```bash
npx hyperframes init my-video --timeline timeline.json --media-root <footage folder> --skip-skills
cd my-video && npx hyperframes lint && npx hyperframes check
```

`--media-root` is where relative `src` paths resolve: set it when the footage is not beside the timeline file (an unpacked `.otioz` needs none). `--link-media` symlinks instead of copying (a copy on Windows). A clip whose file is missing is dropped and reported: relink and re-run rather than patching the HTML. What the converter does with each OTIO feature: `docs/guides/import-from-otio.mdx`. The file it writes: `docs/reference/timeline-import.mdx`; the output points at `https://hyperframes.heygen.com/schema/timeline-import.json`, so check a hand-edited file against it.

## 3. What carries over

Read the warnings: the script prints them to stderr and `init` prints them again with a count. Relay them to the person; nothing saves them in the project. Every skipped or approximated item is named there. Full table: `docs/reference/timeline-import.mdx`.

- **Applied:** tracks and lanes, trims, nested stacks and track/stack `source_range`, disabled items (skipped), speed, freeze frames (a still), image sequences (encoded to a video with ffmpeg; missing images are held), and dissolves including to and from a gap, clamped to the footage beyond each trim point.
- **Hard cuts:** wipes and other transition types, and audio transitions. Add them afterwards (`/hyperframes-registry`).
- **Not supported:** generated media, reverse playback, remote URLs, effects, markers, and any editor-specific `metadata` (only OTIO's own data model is read). Say so, and offer to rebuild what matters (`/hyperframes`, `/media-use`).
- **Bundles:** the script unpacks `.otioz` into `<name>-media` in the current folder (`--extract-to` picks another; running again reuses it); `.otiod` needs nothing.
- **Frame rate:** the composition uses the timeline's rate (NTSC stays `30000/1001`); on mixed rates, cuts on the other rates can fall between frames.
- **Sound:** a video-only timeline keeps each file's own audio; with audio tracks, videos are muted. Levels and fades are not read.

Verify against the editor's cut list, not the JSON: `npx hyperframes timeline --json` for starts and ends, then a render compared at each cut. If a clip starts outside its file, `init` names it: it will be silent or frozen.

Script tests: `~/.venvs/otio/bin/python -I scripts/otio_flatten_test.py`.
