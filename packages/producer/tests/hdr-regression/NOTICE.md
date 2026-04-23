# Source attribution

`src/hdr-clip.mp4` is a 5-second excerpt re-encoded from a publicly available
HDR demonstration video on YouTube, used here solely as a test fixture to
exercise the HyperFrames HDR rendering pipeline.

- **Source URL**: https://youtu.be/56hEFqjKG0s
- **Excerpt**: 0:01:18 – 0:01:23 (5 seconds, no audio)
- **Re-encoded as**: HEVC Main10, 1920x1080, 30 fps, BT.2020 PQ (HDR10), no audio

The original video is owned by its publisher; this excerpt is included only
for the purpose of regression-testing HDR color-space handling, encoder
parameters, and HDR10 metadata signaling. It is not redistributed as
standalone content. If the rights holder objects to inclusion, this clip can
be replaced with any other 5-second BT.2020 PQ HEVC Main10 sample without
changes to the surrounding test code.
