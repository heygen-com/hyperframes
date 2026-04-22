/**
 * Bonanza Labs — LLM-Agnostic Provider
 * Supports: GLM 5.1, Qwen, Claude, GPT, MiniMax, Ollama local
 */

export interface LLMProvider {
  name: string;
  generateScript(prompt: string, options?: ScriptOptions): Promise<VideoScript>;
  generateScenes(prompt: string, sceneCount: number): Promise<Scene[]>;
}

export interface ScriptOptions {
  style?: 'corporate' | 'viral' | 'tutorial' | 'news' | 'cinematic';
  duration?: number;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  voiceover?: boolean;
}

export interface VideoScript {
  title: string;
  description: string;
  scenes: Scene[];
  style: string;
  totalDuration: number;
}

export interface Scene {
  id: number;
  title: string;
  duration: number;
  narration: string;
  visualDescription: string;
  animationType: 'title' | 'bullet-list' | 'counter' | 'comparison' | 'cta';
  data?: Record<string, unknown>;
}

// ===== Ollama Provider (GLM 5.1, Qwen, local models) =====

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private baseUrl: string;
  private model: string;

  constructor(baseUrl = 'http://localhost:11434', model = 'glm-5.1:cloud') {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async generateScript(prompt: string, options?: ScriptOptions): Promise<VideoScript> {
    const systemPrompt = this.buildSystemPrompt(options);
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        stream: false,
        format: 'json'
      })
    });

    const data = await response.json() as { message: { content: string } };
    return this.parseScript(data.message.content);
  }

  async generateScenes(prompt: string, sceneCount: number): Promise<Scene[]> {
    const script = await this.generateScript(prompt, { duration: sceneCount * 5 });
    return script.scenes;
  }

  private buildSystemPrompt(options?: ScriptOptions): string {
    const style = options?.style ?? 'viral';
    const duration = options?.duration ?? 30;
    const sceneCount = Math.max(3, Math.ceil(duration / 6));

    return `You are a video script writer for HyperFrames. Create a ${style}-style video script about the given topic.
Duration: ~${duration}s, ${sceneCount} scenes.
Return JSON: { "title": string, "description": string, "scenes": [{ "id": number, "title": string, "duration": number, "narration": string, "visualDescription": string, "animationType": "title"|"bullet-list"|"counter"|"comparison"|"cta", "data": object }] }
Keep narration concise (2-3 sentences per scene). Make it engaging.`;
  }

  private parseScript(content: string): VideoScript {
    try {
      const json = JSON.parse(content);
      return {
        title: json.title ?? 'Untitled',
        description: json.description ?? '',
        scenes: json.scenes ?? [],
        style: 'viral',
        totalDuration: json.scenes?.reduce((sum: number, s: Scene) => sum + s.duration, 0) ?? 30
      };
    } catch {
      // Fallback: create a basic script from raw text
      return {
        title: 'Generated Video',
        description: content.slice(0, 200),
        scenes: [{
          id: 1, title: 'Main', duration: 30,
          narration: content.slice(0, 500),
          visualDescription: 'Title card with narration text',
          animationType: 'title' as const
        }],
        style: 'viral',
        totalDuration: 30
      };
    }
  }
}

// ===== OpenAI-compatible Provider (GPT, Claude via proxy, etc.) =====

export class OpenAICompatibleProvider implements LLMProvider {
  name = 'openai-compatible';
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(apiKey: string, baseUrl = 'https://api.openai.com/v1', model = 'gpt-4o') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async generateScript(prompt: string, options?: ScriptOptions): Promise<VideoScript> {
    const ollama = new OllamaProvider();
    const systemPrompt = ollama['buildSystemPrompt'](options);
    
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json() as { choices: [{ message: { content: string } }] };
    const ollamaParse = ollama['parseScript'];
    return ollamaParse.call(ollama, data.choices[0].message.content);
  }

  async generateScenes(prompt: string, sceneCount: number): Promise<Scene[]> {
    const script = await this.generateScript(prompt, { duration: sceneCount * 5 });
    return script.scenes;
  }
}

// ===== Template Fallback (no LLM needed) =====

export class TemplateProvider implements LLMProvider {
  name = 'template';

  async generateScript(prompt: string, options?: ScriptOptions): Promise<VideoScript> {
    const scenes: Scene[] = [
      { id: 1, title: prompt.slice(0, 60), duration: 5, narration: `Welcome to ${prompt}`, visualDescription: 'Bold title card', animationType: 'title' },
      { id: 2, title: 'Key Points', duration: 8, narration: 'Here are the key points to know.', visualDescription: 'Bullet list', animationType: 'bullet-list', data: { items: ['Point 1', 'Point 2', 'Point 3'] } },
      { id: 3, title: 'Impact', duration: 7, narration: 'This matters because it changes everything.', visualDescription: 'Counter animation', animationType: 'counter', data: { value: 100, label: 'Impact Score' } },
      { id: 4, title: 'Get Started', duration: 5, narration: 'Start today and see the difference.', visualDescription: 'Call to action', animationType: 'cta' }
    ];

    return { title: prompt.slice(0, 60), description: `Video about ${prompt}`, scenes, style: options?.style ?? 'viral', totalDuration: 25 };
  }

  async generateScenes(prompt: string, sceneCount: number): Promise<Scene[]> {
    const script = await this.generateScript(prompt);
    return script.scenes.slice(0, sceneCount);
  }
}

// ===== Provider Factory =====

export type ProviderConfig = 
  | { type: 'ollama'; baseUrl?: string; model?: string }
  | { type: 'openai'; apiKey: string; baseUrl?: string; model?: string }
  | { type: 'template' };

export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.type) {
    case 'ollama':
      return new OllamaProvider(config.baseUrl, config.model);
    case 'openai':
      return new OpenAICompatibleProvider(config.apiKey, config.baseUrl, config.model);
    case 'template':
      return new TemplateProvider();
  }
}

// Default: Ollama with GLM 5.1 cloud
export const defaultProvider = new OllamaProvider('http://localhost:11434', 'glm-5.1:cloud');