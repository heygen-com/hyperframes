export type LocalShareAudience = "public" | "team" | "invite" | "private";
export interface LocalShareSpace {
  id: string;
  name: string;
  bound: boolean;
  canCreate: boolean;
  audiences: LocalShareAudience[];
  used: number | null;
  limit: number | null;
}
export interface LocalShareState {
  state: "not_shared" | "link_off" | "ready" | "processing" | "unavailable";
  url: string | null;
  manageUrl: string;
  changed: boolean;
  audience: LocalShareAudience | null;
  spaceId: string | null;
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
  action: "share" | "update" | "access" | "off" | "on";
  audience?: LocalShareAudience;
  space?: string;
};
