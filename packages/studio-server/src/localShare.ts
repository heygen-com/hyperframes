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
  upToDate?: boolean;
  updated?: boolean;
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
  includeSource?: boolean;
};
export type LocalShareInteraction =
  | { event: "share_opened"; link: "none" | "live" | "changed" }
  | { event: "share_link_copied"; via: "copy" }
  | { event: "share_upgrade_clicked"; reason: "project_limit" | "sharing_permissions" }
  | { event: "share_audience_selected"; audience: LocalShareAudience }
  | { event: "share_source_toggled"; enabled: boolean }
  | { event: "share_navigation_clicked"; destination: "manage" | "shared_page" }
  | { event: "share_action_clicked"; action: LocalShareAction["action"] };
