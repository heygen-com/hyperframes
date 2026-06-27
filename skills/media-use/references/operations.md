# Media operations — agent guidance

media-use resolves and remembers assets. For **operating** on them — cutting,
reframing, stitching, transforming — it does not wrap every action as a bespoke
command. Instead it points you at the right local tool (decision OP1). Run the
tool, then register the output with `resolve --from <output> --type <type>` so the
result lands in the ledger and the global cache like any other asset.

All tools below are local and free. ffmpeg is assumed present (it backs the
engine already).

## Cut / trim — keep a slice

```bash
ffmpeg -i in.mp4 -ss 00:00:12 -to 00:00:20 -c copy out.mp4   # 0:12–0:20, no re-encode
```

In-composition trimming usually needs **no new file**: a clip plays a sub-window
via `data-media-start` + `data-duration` (see hyperframes-core). Only cut a
physical file when exporting/assembling outside the composition.

## Reframe / crop — change aspect ratio

```bash
# 16:9 -> 9:16, crop centered
ffmpeg -i in.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920" out.mp4
```

For a non-destructive crop, set a `clip-path` on the element in the composition
itself (render-time, source file untouched) instead of re-encoding with ffmpeg.

## Montage / stitch — join clips

```bash
printf "file '%s'\n" a.mp4 b.mp4 c.mp4 > list.txt
ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4
```

## Silence-cut / highlight — trim dead air, grab the best moment

```bash
auto-editor in.mp4 --edit audio:threshold=4% -o tight.mp4   # pip install auto-editor
scenedetect -i in.mp4 detect-adaptive list-scenes           # pip install scenedetect
```

## Transforms with a quality choice (process)

These have a local option AND a higher-quality HeyGen-CLI option. Run the local
one for free/offline; use the HeyGen CLI when quality matters. Showing the user
a **side-by-side** (local vs HeyGen) is the honest way to let them choose.

| Op                 | Local (free)                                       | HeyGen CLI (quality)        |
| ------------------ | -------------------------------------------------- | --------------------------- |
| Background removal | `hyperframes remove-background in.png` (u2net)     | `heygen background-removal` |
| Upscale            | `realesrgan-ncnn-vulkan -i in.png -o out.png -s 4` | —                           |
| Lipsync (dub)      | —                                                  | `heygen lipsync`            |
| Translate          | —                                                  | `heygen video-translate`    |

After any op: `resolve --from out.ext --type <type>` to register the derived
asset (it records provenance and auto-promotes to the global cache).

> ponytail: media-use doesn't re-wrap ffmpeg/heygen here — that's deliberate
> (OP1). The value it adds is the ledger + global reuse on the _output_, via
> `--from`. Add a thin `process` verb only if agents repeatedly fumble these
> recipes.
