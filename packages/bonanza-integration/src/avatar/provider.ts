/**
 * Bonanza Labs — HeyGen Avatar Integration
 * Generate avatar videos for news/presenter content
 */

export interface AvatarProvider {
  name: string;
  createVideo(request: AvatarRequest): Promise<AvatarJob>;
  waitForVideo(jobId: string): Promise<AvatarResult>;
  listAvatars(): Promise<AvatarInfo[]>;
}

export interface AvatarRequest {
  script: string;
  avatarId?: string;
  voiceId?: string;
  background?: string;
  dimensions?: { width: number; height: number };
}

export interface AvatarJob {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface AvatarResult {
  videoUrl: string;
  duration: number;
  thumbnailUrl?: string;
}

export interface AvatarInfo {
  avatarId: string;
  name: string;
  previewUrl?: string;
  gender?: 'male' | 'female';
}

// ===== HeyGen Provider =====

export class HeyGenAvatarProvider implements AvatarProvider {
  name = 'heygen';
  private apiKey: string;
  private baseUrl = 'https://api.heygen.com/v2';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async createVideo(request: AvatarRequest): Promise<AvatarJob> {
    const response = await fetch(`${this.baseUrl}/video/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.apiKey
      },
      body: JSON.stringify({
        test: false,
        caption: false,
        dimension: request.dimensions 
          ? { width: request.dimensions.width, height: request.dimensions.height }
          : { width: 1920, height: 1080 },
        video_inputs: [{
          character: {
            type: 'avatar',
            avatar_id: request.avatarId ?? 'josh2_public_3d',
            avatar_style: 'normal'
          },
          voice: {
            type: 'text',
            input_text: request.script,
            voice_id: request.voiceId ?? '1a9f0f6c6c5b4f4f8c8b9f9f6c6c5b4f'
          },
          background: {
            type: request.background ? 'image' : 'color',
            value: request.background ?? '#ffffff'
          }
        }]
      })
    });

    const data = await response.json() as { data: { video_id: string } };
    return { jobId: data.data.video_id, status: 'pending' };
  }

  async waitForVideo(jobId: string): Promise<AvatarResult> {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      const response = await fetch(`${this.baseUrl}/video/status?video_id=${jobId}`, {
        headers: { 'X-Api-Key': this.apiKey }
      });
      const data = await response.json() as { data: { status: string; video_url?: string; thumbnail_url?: string; duration?: number } };
      
      if (data.data.status === 'completed') {
        return {
          videoUrl: data.data.video_url ?? '',
          duration: data.data.duration ?? 0,
          thumbnailUrl: data.data.thumbnail_url
        };
      }
      if (data.data.status === 'failed') {
        throw new Error('HeyGen video generation failed');
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    throw new Error('HeyGen video timed out');
  }

  async listAvatars(): Promise<AvatarInfo[]> {
    const response = await fetch(`${this.baseUrl}/avatar/list`, {
      headers: { 'X-Api-Key': this.apiKey }
    });
    const data = await response.json() as { data: { avatars: Array<{ avatar_id: string; avatar_name: string; preview_image_url?: string; gender?: string }> } };
    return data.data.avatars.map(a => ({
      avatarId: a.avatar_id,
      name: a.avatar_name,
      previewUrl: a.preview_image_url,
      gender: a.gender as 'male' | 'female' | undefined
    }));
  }
}

export function createAvatarProvider(apiKey: string): AvatarProvider {
  return new HeyGenAvatarProvider(apiKey);
}