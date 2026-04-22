/**
 * Bonanza Labs — Video Pipeline
 * Full stack: LLM script → HyperFrames composition → Voice → Render → Avatar → Payment
 */

import { createProvider, defaultProvider, type ProviderConfig } from './llm/provider.js';
import { createVoiceProvider, defaultVoiceProvider, type VoiceConfig } from './voice/provider.js';
import { createAvatarProvider, type AvatarProvider } from './avatar/provider.js';
import { createPaymentProvider, VIDEO_PRICING, type VideoTier } from './payment/provider.js';

export interface PipelineConfig {
  llm?: ProviderConfig;
  voice?: VoiceConfig;
  avatar?: { apiKey: string };
  payment?: { walletAddress: string };
  outputDir?: string;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  tier?: VideoTier;
}

export interface PipelineResult {
  scriptPath: string;
  voicePath?: string;
  videoPath: string;
  avatarVideoPath?: string;
  invoiceId?: string;
  duration: number;
}

export class VideoPipeline {
  private llm;
  private voice;
  private avatar?: AvatarProvider;
  private payment;
  private outputDir: string;
  private aspectRatio: '16:9' | '9:16' | '1:1';
  private tier: VideoTier;

  constructor(config: PipelineConfig = {}) {
    this.llm = config.llm ? createProvider(config.llm) : defaultProvider;
    this.voice = config.voice ? createVoiceProvider(config.voice) : defaultVoiceProvider;
    this.avatar = config.avatar ? createAvatarProvider(config.avatar.apiKey) : undefined;
    this.payment = config.payment ? createPaymentProvider(config.payment.walletAddress) : undefined;
    this.outputDir = config.outputDir ?? './output';
    this.aspectRatio = config.aspectRatio ?? '16:9';
    this.tier = config.tier ?? 'standard';
  }

  /**
   * Generate a complete video from a topic prompt
   * 1. LLM generates script
   * 2. Voice synthesizes narration
   * 3. HyperFrames renders composition
   * 4. (Optional) HeyGen avatar overlay
   * 5. (Optional) x402 payment invoice
   */
  async generate(prompt: string, options?: { skipVoice?: boolean; skipAvatar?: boolean }): Promise<PipelineResult> {
    console.log(`🎬 Bonanza Video Pipeline — "${prompt.slice(0, 50)}..."`);
    
    // Step 1: Generate script
    console.log('📝 Step 1/4: Generating script...');
    const script = await this.llm.generateScript(prompt, {
      style: 'viral',
      aspectRatio: this.aspectRatio
    });
    console.log(`   → ${script.scenes.length} scenes, ~${script.totalDuration}s`);

    // Step 2: Generate voiceover
    let voicePath: string | undefined;
    if (!options?.skipVoice) {
      console.log('🗣️ Step 2/4: Synthesizing voiceover...');
      const fullNarration = script.scenes.map(s => s.narration).join(' ');
      const voiceResult = await this.voice.synthesize(fullNarration, {
        voice: 'en-US-AriaNeural',
        format: 'mp3'
      });
      voicePath = `${this.outputDir}/voiceover.mp3`;
      const fs = await import('fs');
      fs.mkdirSync(this.outputDir, { recursive: true });
      fs.writeFileSync(voicePath, voiceResult.audioBuffer);
      console.log(`   → ${voiceResult.duration.toFixed(1)}s, ${(voiceResult.audioBuffer.length / 1024).toFixed(0)}KB`);
    } else {
      console.log('⏭️ Step 2/4: Voiceover skipped');
    }

    // Step 3: Render video with HyperFrames
    console.log('🎨 Step 3/4: Rendering video...');
    const videoPath = `${this.outputDir}/video.mp4`;
    // HyperFrames rendering happens via CLI: `hyperframes render`
    // We generate the composition HTML
    const composition = this.generateComposition(script);
    const fs = await import('fs');
    fs.writeFileSync(`${this.outputDir}/composition.html`, composition);
    console.log(`   → Composition: ${this.outputDir}/composition.html`);
    console.log(`   → Run: hyperframes render ${this.outputDir}/composition.html -o ${videoPath}`);

    // Step 4: (Optional) Avatar overlay
    let avatarVideoPath: string | undefined;
    if (this.avatar && !options?.skipAvatar) {
      console.log('🧑 Step 4/4: Generating avatar overlay...');
      const job = await this.avatar.createVideo({
        script: script.scenes.map(s => s.narration).join(' '),
        dimensions: this.aspectRatio === '9:16' 
          ? { width: 1080, height: 1920 } 
          : { width: 1920, height: 1080 }
      });
      console.log(`   → Job: ${job.jobId}`);
      const result = await this.avatar.waitForVideo(job.jobId);
      avatarVideoPath = result.videoUrl;
      console.log(`   → Avatar video: ${result.videoUrl}`);
    } else {
      console.log('⏭️ Step 4/4: Avatar skipped');
    }

    // Payment
    let invoiceId: string | undefined;
    if (this.payment) {
      const tier = VIDEO_PRICING[this.tier];
      const invoice = await this.payment.createInvoice(tier.price, `Bonanza Video: ${script.title}`);
      invoiceId = invoice.invoiceId;
      console.log(`💳 Invoice: ${invoice.invoiceId} — $${tier.price} USDC`);
    }

    console.log('✅ Pipeline complete!');
    return {
      scriptPath: `${this.outputDir}/composition.html`,
      voicePath,
      videoPath,
      avatarVideoPath,
      invoiceId,
      duration: script.totalDuration
    };
  }

  /**
   * Generate HyperFrames HTML composition from script
   */
  private generateComposition(script: import('./llm/provider.js').VideoScript): string {
    const scenes = script.scenes.map((scene, i) => {
      const animationMap: Record<string, string> = {
        'title': 'data-hf-animation="fade-in-up"',
        'bullet-list': 'data-hf-animation="stagger-in"',
        'counter': 'data-hf-animation="count-up"',
        'comparison': 'data-hf-animation="slide-in"',
        'cta': 'data-hf-animation="pulse"'
      };

      return `
    <section data-hf-scene="${i + 1}" data-hf-duration="${scene.duration}s" ${animationMap[scene.animationType] ?? ''}>
      <h2>${scene.title}</h2>
      <p>${scene.narration}</p>
      ${scene.data ? `<pre>${JSON.stringify(scene.data, null, 2)}</pre>` : ''}
    </section>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${script.title}</title>
  <script src="https://cdn.hyperframes.com/runtime.js"></script>
  <style>
    body { margin: 0; font-family: system-ui; background: #0a0a0a; color: white; }
    section { display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 100vh; padding: 2rem; text-align: center; }
    h2 { font-size: 3rem; margin-bottom: 1rem; background: linear-gradient(135deg, #7c3aed, #06b6d4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    p { font-size: 1.5rem; opacity: 0.9; max-width: 60ch; }
    pre { display: none; }
  </style>
</head>
<body>${scenes}
</body>
</html>`;
  }
}

// Quick API
export async function generateVideo(prompt: string, config?: PipelineConfig): Promise<PipelineResult> {
  const pipeline = new VideoPipeline(config);
  return pipeline.generate(prompt);
}