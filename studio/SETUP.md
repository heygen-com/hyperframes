# Video Studio Setup

## Install Prerequisites (Windows)

### 1. Node.js 22+
Download from https://nodejs.org (LTS) or via winget:
```powershell
winget install OpenJS.NodeJS.LTS
```

### 2. Bun
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

### 3. FFmpeg
```powershell
winget install Gyan.FFmpeg
```
Then restart your terminal to refresh PATH.

### 4. Python dependencies (for filler removal)
```bash
pip install openai-whisper ffmpeg-python
```

### 5. Verify everything works
```bash
node --version   # should be 22+
bun --version
ffmpeg -version
python -c "import whisper; print('whisper ok')"
```

---

## Pipeline Commands

### Raw video → edited video + motion graphics
```bash
python studio/pipeline.py my_raw_video.mp4 --project my-video
```
This will:
1. Transcribe the video with Whisper
2. Detect and remove filler words (um, uh, like, you know, etc.)
3. Scaffold a HyperFrames project with the clean video + transcript

### Script file → TTS narration → video
```bash
python studio/pipeline.py my_script.txt --project my-video --voice af_heart
```

### Just remove fillers (no HyperFrames project)
```bash
python studio/remove_fillers.py input.mp4 output_clean.mp4
python studio/remove_fillers.py input.mp4 --dry-run    # preview only
python studio/remove_fillers.py input.mp4 --model medium  # better accuracy
python studio/remove_fillers.py input.mp4 --fillers "um,uh,like,you know,i mean"
```

---

## Motion Graphics Workflow (after pipeline runs)

```bash
# 1. Preview in browser (live reload)
npx hyperframes preview --cwd ./my-video

# 2. Tell Claude what you want:
#    "add animated captions synced to my transcript"
#    "add a lower-third with my name at 5 seconds"
#    "add an intro title card with motion"
#    "add background music at 20% volume"

# 3. Lint & validate
npx hyperframes lint --cwd ./my-video
npx hyperframes validate --cwd ./my-video

# 4. Render final video
npx hyperframes render --cwd ./my-video -o final.mp4 --quality high
```

---

## Available Skills (invoke with /skill-name in Claude)

| Skill | What it does |
|-------|-------------|
| `/hyperframes` | Composition authoring, timing, captions, motion |
| `/hyperframes-cli` | init, lint, inspect, preview, render |
| `/hyperframes-media` | TTS, transcription, background removal |
| `/gsap` | GSAP animation patterns |
| `/lottie` | Lottie animations |
| `/css-animations` | CSS keyframe animations |
| `/tailwind` | Tailwind v4 styling |
| `/three` | Three.js 3D effects |

---

## Whisper Models

| Model | Size | Use case |
|-------|------|----------|
| tiny | 75 MB | Quick tests |
| base | 142 MB | Short clear audio |
| small | 466 MB | **Default** |
| medium | 1.5 GB | Noisy audio |
| large-v3 | 3.1 GB | Production quality |

## TTS Voices

| Voice | Style |
|-------|-------|
| af_heart | Warm, natural (default) |
| af_nova | Professional |
| am_adam | Tutorial/how-to |
| bf_emma | British, formal |
| af_sky | Energetic |
| am_michael | Authoritative |
