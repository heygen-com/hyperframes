# Producer Parity Fixtures

Fixtures used by `src/parity-harness.ts`.

- `fixtures/minimal-wysiwyg.html`: CI-safe fixture with deterministic animation.
- `fixtures/good-preview-bad-producer.json`: checkpoint metadata for the known border-radius parity regression.

## Local run example

```bash
cd producer/tests/parity/fixtures
python3 -m http.server 4173
```

Then in another terminal:

```bash
cd producer
pnpm parity:check \
  --preview-url "http://127.0.0.1:4173/minimal-wysiwyg.html" \
  --producer-url "http://127.0.0.1:4173/minimal-wysiwyg.html?mode=producer" \
  --checkpoints "0,0.5,1,1.5" \
  --allow-mismatch-ratio 0 \
  --emulate-producer-swap true
```
