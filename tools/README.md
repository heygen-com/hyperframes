# Local Tools

This directory is for repo-local tools that are required by project workflows but
should not become Hyperframes source code.

## whisper.cpp

`tools/whisper.cpp/` is the local Whisper runtime for user-recorded narration.
It is ignored by git because it contains an upstream checkout, build outputs,
and large model weights.

Current expected local paths:

- Wrapper binary: `tools/whisper-cli`
- Wrapper server: `tools/whisper-server`
- Upstream binary: `tools/whisper.cpp/build/bin/whisper-cli`
- Upstream server: `tools/whisper.cpp/build/bin/whisper-server`
- Production model: `tools/whisper.cpp/models/ggml-large-v3.bin`

The global convenience symlink should point back into this repo:

```bash
readlink -f ~/.local/bin/whisper-cli
```

The wrappers set `LD_LIBRARY_PATH` for the moved upstream build tree, so callers
do not need to remember the `build/src` and `build/ggml/src` library paths.

For Korean or unknown-language recordings, do not use `.en` Whisper models.
Use `large-v3` for production alignment and smaller multilingual models only
for fast iteration.
