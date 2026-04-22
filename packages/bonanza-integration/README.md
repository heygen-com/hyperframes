# @bonanza/hyperframes-integration

LLM-agnostic video creation pipeline for HyperFrames — by [Bonanza Labs](https://bonanza-labs.tiiny.site)

## Features

- 🤖 **LLM-agnostic** — Use GLM 5.1, Qwen, Claude, GPT, or template fallback
- 🗣️ **Voice** — Edge-TTS (free) or ElevenLabs
- 🧑 **Avatars** — HeyGen presenter overlay
- 💳 **x402 Payments** — Pay-per-video in USDC on Base
- 🎬 **Full pipeline** — Script → Voice → Render → Avatar → Payment

## Quick Start

```bash
# Install
bun add @bonanza/hyperframes-integration

# Generate a video
import { generateVideo } from '@bonanza/hyperframes-integration';

const result = await generateVideo('AI agents are changing everything', {
  llm: { type: 'ollama' },           // GLM 5.1 cloud
  voice: { type: 'edge-tts' },        // Free TTS
  tier: 'standard',                   // $0.50 USDC
});
```

## CLI

```bash
bonanza-video "AI agents are the future"
bonanza-video --llm ollama --voice jenny "The future of payments"
bonanza-video --tier avatar --aspect 9:16 "Breaking news"
```

## Providers

### LLM
| Provider | Setup | Cost |
|----------|-------|------|
| Ollama (GLM 5.1) | `{ type: 'ollama' }` | Free (cloud proxy) |
| OpenAI-compatible | `{ type: 'openai', apiKey: '...' }` | Per-token |
| Template | `{ type: 'template' }` | Free, no LLM |

### Voice
| Provider | Setup | Cost |
|----------|-------|------|
| Edge-TTS | `{ type: 'edge-tts' }` | Free |
| ElevenLabs | `{ type: 'elevenlabs', apiKey: '...' }` | Per-character |

### Pricing
| Tier | Price | Max Duration |
|------|-------|-------------|
| Standard | $0.50 USDC | 60s |
| HD | $1.00 USDC | 120s |
| Avatar | $2.50 USDC | 180s |
| Premium | $5.00 USDC | 300s |

## License

Apache-2.0