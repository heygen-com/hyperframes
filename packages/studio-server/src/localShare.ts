export type LocalShareAudience = "public" | "team" | "invite" | "private";
export interface LocalShareSpace {
  id: string;
  name: string;
  bound: boolean;
  canCreate: boolean;
  plan?: "free" | "subscribed" | null;
  upgradeUrl?: string | null;
  audiences: LocalShareAudience[];
  used: number | null;
  limit: number | null;
}
export interface LocalShareState {
  state: "not_shared" | "link_off" | "ready" | "processing" | "failed" | "unavailable";
  url: string | null;
  manageUrl: string;
  changed: boolean | null;
  hasReadyVersion?: boolean;
  failure?: string | null;
  audience: LocalShareAudience | null;
  spaceId: string | null;
  source: "not_checked" | "ready" | "video_only";
}
export interface LocalShareJob {
  id: string;
  state: "running" | "done" | "failed";
  step: string;
  result: LocalShareState | null;
  error: { code: string; message: string } | null;
}
export interface LocalShareSnapshot {
  versionSharing: boolean;
  share: LocalShareState;
  spaces: LocalShareSpace[];
  job: LocalShareJob | null;
}
export type LocalShareAction = {
  action: "share" | "update" | "access" | "off" | "on" | "login";
  audience?: LocalShareAudience;
  space?: string;
  videoOnly?: boolean;
};
export type LocalShareInteraction =
  | { event: "share_opened"; link: "none" | "live" | "changed" }
  | { event: "share_link_copied"; via: "copy" };
