export interface AmplifierQueueMessage {
  version: "2026-05-15";
  jobId: string;
  ownerUserId: string;
  assetsBucket: string;
  baseKey: string;
  sourceKey: string;
  briefKey: string;
  planKey: string;
  createdAt: string;
}

export interface ArtifactRef {
  key: string;
  url: string;
  mimeType: string;
}

export interface ExplainerPrimaryAuthor {
  name: string;
  role?: string | null;
  bio?: string | null;
  imageUrl?: string | null;
  website?: string | null;
  linkedin?: string | null;
  x?: string | null;
}

export interface ExplainerPublicationRef {
  name?: string | null;
  subdomain?: string | null;
  customDomain?: string | null;
  url?: string | null;
  linkedinUrl?: string | null;
}

export interface ExplainerBookletLink {
  shortUrl: string;
  sourceUrl: string;
  slug?: string | null;
}

export interface ExplainerArticleRef {
  title: string;
  subtitle?: string | null;
  url: string;
  description?: string | null;
  coverImage?: string | null;
  publication?: ExplainerPublicationRef | null;
  primaryAuthor?: ExplainerPrimaryAuthor | null;
  bookletLink?: ExplainerBookletLink | null;
}

export interface ExplainerVideoBrief {
  version: "2026-05-15";
  article: ExplainerArticleRef;
  interview: {
    goal: string;
    customGoal?: string;
    audience: string;
    customAudience?: string;
    durationSeconds: 30 | 45 | 60 | 90;
    narrativeStyle: string;
    textMode: "preserve" | "condense" | "rewrite";
    visualMode: "editorial" | "motion_social" | "documentary" | "captions_only";
    voiceoverMode: "ai_voice" | "captions_only" | "none";
    ctaMode: "booklet" | "article" | "newsletter" | "author";
    productionNotes?: string;
  };
  defaultsApplied: string[];
  createdAt: string;
}

export interface ExplainerScenePlan {
  id: string;
  purpose: string;
  source: "article" | "derived" | "author" | "cta";
  durationSeconds: number;
}

export interface ExplainerVideoRenderPlan {
  version: "2026-05-15";
  rendererKind: "hyperframes" | "remotion";
  compositionKind:
    | "article_explainer"
    | "documentary_teaser"
    | "social_recap"
    | "capsule_exec_brief";
  targetDurationSeconds: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
  voice: {
    enabled: boolean;
    provider?: "elevenlabs";
    style?: "energetic_american" | "calm_executive" | "documentary";
  };
  captions: {
    enabled: boolean;
    burnIn: boolean;
    exportSrt: boolean;
  };
  scenes: ExplainerScenePlan[];
  cta: {
    mode: "booklet" | "article" | "newsletter" | "author";
    label: string;
    url?: string | null;
  };
  worker: {
    status: "pending_deployment" | "queued" | "processing" | "completed" | "failed";
    queueName?: string | null;
    notes: string;
  };
  billing: {
    billingSurfaceId: string;
    billingAccountId?: string;
    rawBillingSurfaceKey?: string;
  };
}

export interface ExplainerSourceArtifact {
  version: "2026-05-15";
  article: {
    text: string;
    paragraphs: string[];
    bodyHtml?: string | null;
    authors?: unknown;
  };
}

export interface ExplainerVideoJobRecord {
  userId: string;
  itemType: "explainerJob";
  ownerUserId: string;
  jobId: string;
  status:
    | "queued"
    | "planning"
    | "storyboarding"
    | "voiceover"
    | "rendering"
    | "uploading"
    | "completed"
    | "failed";
  stage: string;
  progress: number;
  workerStatus: "pending_deployment" | "queued" | "processing" | "completed" | "failed";
  message?: string | null;
  failureCode?: string | null;
  article: ExplainerArticleRef;
  videoBrief: ExplainerVideoBrief;
  plan: ExplainerVideoRenderPlan;
  artifacts: {
    source?: ArtifactRef | null;
    brief: ArtifactRef;
    plan: ArtifactRef;
    script?: ArtifactRef | null;
    transcript?: ArtifactRef | null;
    captions?: ArtifactRef | null;
    poster?: ArtifactRef | null;
    voiceover?: ArtifactRef | null;
    video?: ArtifactRef | null;
  };
  billingSurfaceId: string;
  billingAccountId?: string;
  rawBillingSurfaceKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RenderSceneCard {
  id: string;
  kind: "hook" | "context" | "insight" | "author" | "cta";
  eyebrow: string;
  title: string;
  body: string;
  meta?: string | null;
  ctaLabel?: string | null;
  alignment: "left" | "right";
  startSeconds: number;
  durationSeconds: number;
}

export interface ScriptSegment {
  id: string;
  title: string;
  narration: string;
  durationSeconds: number;
}

export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export interface ExplainerScript {
  version: "2026-05-15";
  targetDurationSeconds: number;
  fullNarration: string;
  scenes: RenderSceneCard[];
  segments: ScriptSegment[];
}
