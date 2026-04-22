/**
 * Bonanza Labs — Voice Integration
 * Edge-TTS, ElevenLabs, HeyGen voice cloning
 */

export interface VoiceProvider {
  name: string;
  synthesize(text: string, options?: VoiceOptions): Promise<VoiceResult>;
  listVoices(): Promise<VoiceInfo[]>;
}

export interface VoiceOptions {
  voice?: string;
  speed?: number;
  pitch?: number;
  format?: 'mp3' | 'wav';
  sampleRate?: number;
}

export interface VoiceResult {
  audioBuffer: Buffer;
  duration: number;
  format: string;
  voice: string;
}

export interface VoiceInfo {
  id: string;
  name: string;
  language: string;
  gender: 'male' | 'female';
  preview?: string;
}

// ===== Edge-TTS Provider (Free, no API key) =====

export class EdgeTTSProvider implements VoiceProvider {
  name = 'edge-tts';

  async synthesize(text: string, options?: VoiceOptions): Promise<VoiceResult> {
    const voice = options?.voice ?? 'en-US-AriaNeural';
    const { execSync } = await import('child_process');
    
    const tmpFile = `/tmp/bonanza-voice-${Date.now()}.${options?.format ?? 'mp3'}`;
    const cmd = `edge-tts --voice "${voice}" --text "${text.replace(/"/g, '\\"')}" --write-media "${tmpFile}"`;
    
    try {
      execSync(cmd, { timeout: 30000 });
      const fs = await import('fs');
      const audioBuffer = fs.readFileSync(tmpFile);
      fs.unlinkSync(tmpFile);
      
      // Estimate duration: ~150 words/min for neural TTS
      const wordCount = text.split(/\s+/).length;
      const duration = (wordCount / 150) * 60;
      
      return { audioBuffer, duration, format: options?.format ?? 'mp3', voice };
    } catch (err) {
      throw new Error(`Edge-TTS synthesis failed: ${err}`);
    }
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return [
      { id: 'en-US-AriaNeural', name: 'Aria', language: 'en-US', gender: 'female' },
      { id: 'en-US-JennyNeural', name: 'Jenny', language: 'en-US', gender: 'female' },
      { id: 'en-US-GuyNeural', name: 'Guy', language: 'en-US', gender: 'male' },
      { id: 'en-US-ChristopherNeural', name: 'Christopher', language: 'en-US', gender: 'male' },
      { id: 'en-US-SoniaNeural', name: 'Sonia', language: 'en-US', gender: 'female' },
      { id: 'en-US-ThomasNeural', name: 'Thomas', language: 'en-US', gender: 'male' },
    ];
  }
}

// ===== ElevenLabs Provider =====

export class ElevenLabsProvider implements VoiceProvider {
  name = 'elevenlabs';
  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async synthesize(text: string, options?: VoiceOptions): Promise<VoiceResult> {
    const voiceId = options?.voice ?? '21m00Tcn4Zl3R1g0OWsA'; // Rachel
    const response = await fetch(`${this.baseUrl}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.apiKey
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const wordCount = text.split(/\s+/).length;
    const duration = (wordCount / 150) * 60;
    
    return { audioBuffer, duration, format: 'mp3', voice: voiceId };
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const response = await fetch(`${this.baseUrl}/voices`, {
      headers: { 'xi-api-key': this.apiKey }
    });
    const data = await response.json() as { voices: Array<{ voice_id: string; name: string; labels: Record<string, string> }> };
    return data.voices.map(v => ({
      id: v.voice_id,
      name: v.name,
      language: v.labels.language ?? 'en',
      gender: (v.labels.gender as 'male' | 'female') ?? 'female'
    }));
  }
}

// ===== Voice Factory =====

export type VoiceConfig =
  | { type: 'edge-tts' }
  | { type: 'elevenlabs'; apiKey: string };

export function createVoiceProvider(config: VoiceConfig): VoiceProvider {
  switch (config.type) {
    case 'edge-tts': return new EdgeTTSProvider();
    case 'elevenlabs': return new ElevenLabsProvider(config.apiKey);
  }
}

export const defaultVoiceProvider = new EdgeTTSProvider();