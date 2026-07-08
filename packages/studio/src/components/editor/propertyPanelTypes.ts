import type { RefObject } from "react";
import type { ArcPathSegment, GsapAnimation } from "@hyperframes/parsers/gsap-parser";
import type { DomEditSelection } from "./domEditing";
import type { ImportedFontAsset } from "./fontAssets";

export interface BackgroundRemovalProgress {
  status: "processing" | "complete" | "failed";
  progress: number;
  stage?: string;
  outputPath?: string;
  backgroundOutputPath?: string;
  error?: string;
  provider?: string;
}

export interface BackgroundRemovalResult {
  outputPath: string;
  backgroundOutputPath?: string;
  provider?: string;
}

export interface PropertyPanelProps {
  projectId: string;
  projectDir: string | null;
  assets: string[];
  element: DomEditSelection | null;
  multiSelectCount?: number;
  copiedAgentPrompt: boolean;
  onClearSelection: () => void;
  onUngroup?: () => void;
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
  onSetAttributeLive: (attr: string, value: string | null) => void | Promise<void>;
  onApplyColorGradingScope?: (
    scope: "source-file" | "project",
    value: string | null,
  ) => Promise<{ changedFiles: number; changedElements: number }>;
  onSetHtmlAttribute: (attr: string, value: string | null) => void | Promise<void>;
  onRemoveBackground?: (
    inputPath: string,
    options: {
      createBackgroundPlate?: boolean;
      quality?: "fast" | "balanced" | "best";
      onProgress?: (progress: BackgroundRemovalProgress) => void;
    },
  ) => Promise<BackgroundRemovalResult>;
  onSetManualOffset: (element: DomEditSelection, next: { x: number; y: number }) => void;
  onSetManualSize: (element: DomEditSelection, next: { width: number; height: number }) => void;
  onSetManualRotation: (element: DomEditSelection, next: { angle: number }) => void;
  onSetText: (value: string, fieldKey?: string) => void;
  onSetTextFieldStyle: (fieldKey: string, property: string, value: string) => void;
  onAddTextField: (afterFieldKey?: string) => string | Promise<string | null> | null;
  onRemoveTextField: (fieldKey: string) => void;
  onAskAgent: () => void;
  onToggleElementHidden?: (elementKey: string, hidden: boolean) => void | Promise<void>;
  onImportAssets?: (files: FileList, dir?: string) => Promise<string[]>;
  fontAssets?: ImportedFontAsset[];
  onImportFonts?: (files: FileList | File[]) => Promise<ImportedFontAsset[]>;
  previewIframeRef?: RefObject<HTMLIFrameElement | null>;
  gsapAnimations?: GsapAnimation[];
  gsapMultipleTimelines?: boolean;
  gsapUnsupportedTimelinePattern?: boolean;
  onUpdateGsapProperty?: (animId: string, prop: string, value: number | string) => void;
  onUpdateGsapMeta?: (
    animId: string,
    updates: { duration?: number; ease?: string; position?: number },
  ) => void;
  onDeleteGsapAnimation?: (animId: string) => void;
  onAddGsapProperty?: (animId: string, prop: string) => void;
  onRemoveGsapProperty?: (animId: string, prop: string) => void;
  onUpdateGsapFromProperty?: (animId: string, prop: string, value: number | string) => void;
  onAddGsapFromProperty?: (animId: string, prop: string) => void;
  onRemoveGsapFromProperty?: (animId: string, prop: string) => void;
  onAddGsapAnimation?: (method: "to" | "from" | "set" | "fromTo") => void;
  onSetArcPath?: (
    animId: string,
    config: {
      enabled: boolean;
      autoRotate?: boolean | number;
      segments?: ArcPathSegment[];
    },
  ) => void;
  onUpdateArcSegment?: (
    animId: string,
    segmentIndex: number,
    update: Partial<ArcPathSegment>,
  ) => void;
  onUnroll?: (animationId: string) => void;
  onAddKeyframe?: (
    animationId: string,
    percentage: number,
    property: string,
    value: number | string,
  ) => void;
  onRemoveKeyframe?: (animationId: string, percentage: number) => void;
  onUpdateKeyframeEase?: (animationId: string, percentage: number, ease: string) => void;
  onSetAllKeyframeEases?: (animationId: string, ease: string) => void;
  onConvertToKeyframes?: (animationId: string, duration?: number) => void;
  onCommitAnimatedProperty?: (
    selection: DomEditSelection,
    property: string,
    value: number | string,
  ) => Promise<void>;
  onCommitAnimatedProperties?: (
    selection: DomEditSelection,
    props: Record<string, number | string>,
  ) => Promise<void>;
  onSeekToTime?: (time: number) => void;
  recordingState?: "idle" | "recording" | "preview";
  recordingDuration?: number;
  onToggleRecording?: () => void;
  cropMode?: boolean;
  onCropModeChange?: (active: boolean) => void;
}
