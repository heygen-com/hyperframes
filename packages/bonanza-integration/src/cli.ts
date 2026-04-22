#!/usr/bin/env node
/**
 * Bonanza Video CLI — `bonanza-video`
 * Generate videos from a single prompt using HyperFrames + Bonanza Labs
 */

import { VideoPipeline, createProvider, createVoiceProvider } from './index.js';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  if (!command || command === 'help') {
    console.log(`
🎬 Bonanza Video — AI Video Generator

Usage:
  bonanza-video <prompt>              Generate video from prompt
  bonanza-video --llm ollama <prompt> Use Ollama (GLM 5.1)
  bonanza-video --llm template <prompt> Template fallback
  bonanza-video --voice jenny <prompt> Use JennyNeural voice
  bonanza-video --tier hd <prompt>    HD tier ($1 USDC)
  bonanza-video --aspect 9:16 <prompt> Portrait mode

Examples:
  bonanza-video "AI agents are changing everything"
  bonanza-video --llm ollama --voice aria "The future of payments"
  bonanza-video --tier avatar --aspect 9:16 "Breaking news: x402 protocol"
`);
    return;
  }

  // Parse args
  let llmType: 'ollama' | 'template' = 'ollama';
  let voiceName = 'aria';
  let tier = 'standard' as const;
  let aspect = '16:9' as const;
  let promptParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--llm': llmType = args[++i] as 'ollama' | 'template'; break;
      case '--voice': voiceName = args[++i]; break;
      case '--tier': tier = args[++i] as typeof tier; break;
      case '--aspect': aspect = args[++i] as typeof aspect; break;
      default: promptParts.push(args[i]);
    }
  }

  const prompt = promptParts.join(' ');
  if (!prompt) {
    console.error('❌ Please provide a prompt');
    process.exit(1);
  }

  const voiceMap: Record<string, string> = {
    aria: 'en-US-AriaNeural',
    jenny: 'en-US-JennyNeural',
    guy: 'en-US-GuyNeural',
    christopher: 'en-US-ChristopherNeural',
  };

  const pipeline = new VideoPipeline({
    llm: { type: llmType },
    voice: { type: 'edge-tts' },
    aspectRatio: aspect,
    tier,
    outputDir: `./output/${Date.now()}`
  });

  const result = await pipeline.generate(prompt);
  console.log('\n📁 Output:', JSON.stringify(result, null, 2));
}

main().catch(console.error);