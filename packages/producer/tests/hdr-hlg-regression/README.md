# hdr-hlg-regression

Regression test that locks down end-to-end **HDR HLG (BT.2020 ARIB STD-B67)**
video rendering. Companion to `hdr-regression` (PQ), kept as a separate suite
so the HLG-specific encoder/metadata path stays tested in isolation.

## What it covers

| Window | Time         | Shape                                 | Expected |
| ------ | ------------ | ------------------------------------- | -------- |
| A      | 0.0 – 2.5 s  | Baseline HLG video + DOM overlay      | pass     |
| B      | 2.5 – 5.0 s  | Wrapper opacity fade around HLG video | pass     |

The test pins the contract that:

- `extractMediaMetadata` reports `bt2020/arib-std-b67/limited` for the HLG
  source (i.e. HLG is detected and not silently coerced to PQ).
- `isHdrColorSpace` flips the orchestrator into the layered HDR path on the
  HLG signal.
- The HLG source is decoded into `rgb48le` and blitted under the SDR DOM
  overlay on every frame.
- Wrapper-opacity composition (window B) does not break HLG pass-through.
- `hdrEncoder` writes HEVC Main10 / `yuv420p10le` / BT.2020 HLG with the
  correct color tags (no PQ mastering display metadata for HLG).

The suite is intentionally short (5 s, two windows) — it exists to detect
regressions in the HLG-specific code path, not to enumerate every composition
shape (those live in `hdr-regression`).

## Fixture

`src/hdr-hlg-clip.mp4` — last 5 seconds of a user-recorded HEVC HLG clip,
remuxed (no re-encode) so the HLG color tags survive verbatim.

## Running

```bash
cd packages/producer
bun run test hdr-hlg-regression

bun run test:update hdr-hlg-regression
```

In CI it runs in the `hdr` shard alongside `hdr-regression`
(see `.github/workflows/regression.yml`).
