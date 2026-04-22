# Source attribution

`src/clip.mp4` is a 5-second excerpt from a macOS ScreenCaptureKit (ReplayKit)
recording, used here as a regression fixture for the VFR (variable-frame-rate)
freeze bug fixed in PR #360.

- **Original duration**: 21s, recorded via `ReplayKitRecording` (the
  `com.apple.quicktime.author` QuickTime tag identifies this).
- **Excerpt**: 16s–21s of the original, downscaled from 2746×1902 to 480×332,
  re-encoded with `ffmpeg -fps_mode passthrough -c:v libx264 -preset slow
  -crf 28 -an` to preserve the original VFR timestamps.
- **Recorded content**: the public `heygen-com/hyperframes` GitHub repo root
  page. No private, proprietary, or user-identifying content.

## Properties preserved from the original

- `r_frame_rate`: 120/1
- `avg_frame_rate`: ~36.1fps (21720/601)
- `isVFR`: true (70% delta vs `r_frame_rate`, well over the 10% threshold in
  `ffprobe.ts`)
- Pre-fix duplicate-frame rate: ~34% on a mid-file 3s segment extracted at
  30fps — matches the 18–44% observed across segments of the full recording.
