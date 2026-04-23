# HDR Regression Suite

HDR10 (BT.2020 PQ) regression suite with four back-to-back windows (A–D)
covering the highest-value HDR compositing shapes. 10s / 300 frames at 30fps.

## Windows

| # | Window                              | Pipeline aspect under test                                                                                |
| - | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A | Baseline HDR + direct opacity       | HDR pass-through with a GSAP opacity tween directly on the `<video>` element.                             |
| B | Z-order sandwich (DOM → HDR → DOM)  | Orange background, HDR video in the middle, blue overlay on top. Tests z-ordered layer compositing.       |
| C | Transform + border-radius           | HDR `<video>` with `transform: rotate() scale()` + `border-radius` clipping. Tests affine blit pipeline. |
| D | Shader transition (HDR → HDR image) | Shader transition between an HDR video and an HDR PQ image. Tests HDR image transfer cache + shader path. |

## Fixtures

- `src/hdr-clip.mp4` — short HEVC Main10 / BT.2020 PQ clip with a moving
  bright gradient (see `NOTICE.md` for attribution). Reused across windows
  A–G and as scene A of the window-H shader transition.
- `src/hdr-photo-pq.png` — 256×144 16-bit RGB PNG with a hand-injected `cICP`
  chunk (primaries=BT.2020, transfer=SMPTE ST 2084, matrix=GBR, range=full).
  Used as scene B of the window-H shader transition.

ffmpeg is **not** used to generate the PNG because it does not embed `cICP`
in PNGs — without that chunk Chromium would not treat the file as HDR and the
test would silently fall back to SDR.

To regenerate the PNG fixture (deterministic, byte-for-byte stable):

```bash
python3 packages/producer/tests/hdr-regression/scripts/generate-hdr-photo-pq.py
```

## Running

```bash
cd packages/producer
bun run test hdr-regression
bun run test:update hdr-regression
```

In CI it runs in the `hdr` shard alongside `hdr-hlg-regression`
(see `.github/workflows/regression.yml`).
