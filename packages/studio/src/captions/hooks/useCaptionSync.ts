import { useCallback, useRef } from "react";
import { useCaptionStore } from "../store";
import type { CaptionStyle } from "../types";

interface CaptionOverrideEntry {
  wordId?: string;
  wordIndex: number;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  color?: string;
  opacity?: number;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
}

function buildOverrides(model: {
  groupOrder: string[];
  groups: Map<string, { segmentIds: string[] }>;
  segments: Map<string, { wordId?: string; style: Partial<CaptionStyle> }>;
}): CaptionOverrideEntry[] {
  const entries: CaptionOverrideEntry[] = [];
  let globalWordIndex = 0;

  for (const groupId of model.groupOrder) {
    const group = model.groups.get(groupId);
    if (!group) continue;
    for (const segId of group.segmentIds) {
      const seg = model.segments.get(segId);
      if (seg && Object.keys(seg.style).length > 0) {
        const entry: CaptionOverrideEntry = { wordIndex: globalWordIndex };
        if (seg.wordId) entry.wordId = seg.wordId;
        const s = seg.style;
        if (s.x !== undefined) entry.x = s.x;
        if (s.y !== undefined) entry.y = s.y;
        if (s.scaleX !== undefined) entry.scale = s.scaleX;
        if (s.rotation !== undefined) entry.rotation = s.rotation;
        if (s.color !== undefined) entry.color = s.color;
        if (s.opacity !== undefined) entry.opacity = s.opacity;
        if (s.fontSize !== undefined) entry.fontSize = s.fontSize;
        if (s.fontWeight !== undefined) entry.fontWeight = s.fontWeight as number;
        if (s.fontFamily !== undefined) entry.fontFamily = s.fontFamily;
        entries.push(entry);
      }
      globalWordIndex++;
    }
  }

  return entries;
}

/**
 * Provides save/load for caption overrides as a JSON data file.
 * Writes caption-overrides.json next to the composition — never modifies the HTML source.
 */
export function useCaptionSync(projectId: string | null) {
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const save = useCallback(async () => {
    const state = useCaptionStore.getState();
    if (!state.model || !state.sourceFilePath) return;
    const pid = projectIdRef.current;
    if (!pid) return;

    const overrides = buildOverrides(state.model);
    const dir = state.sourceFilePath.replace(/[^/]+$/, "");
    const overridesPath = `${dir}caption-overrides.json`;

    await fetch(
      `/api/projects/${pid}/files/${encodeURIComponent(overridesPath)}`,
      { method: "PUT", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(overrides, null, 2) },
    ).catch(() => {});
  }, []);

  const loadOverrides = useCallback(async () => {
    const state = useCaptionStore.getState();
    if (!state.model || !state.sourceFilePath) return;
    const pid = projectIdRef.current;
    if (!pid) return;

    const dir = state.sourceFilePath.replace(/[^/]+$/, "");
    const overridesPath = `${dir}caption-overrides.json`;

    try {
      const res = await fetch(
        `/api/projects/${pid}/files/${encodeURIComponent(overridesPath)}`,
      );
      const data = await res.json();
      if (!data.content) return;

      const overrides: CaptionOverrideEntry[] = JSON.parse(data.content);
      if (!Array.isArray(overrides)) return;

      const model = state.model;
      const allSegIds: string[] = [];
      for (const groupId of model.groupOrder) {
        const group = model.groups.get(groupId);
        if (!group) continue;
        for (const segId of group.segmentIds) {
          allSegIds.push(segId);
        }
      }

      const newSegments = new Map(model.segments);
      for (const override of overrides) {
        const segId = allSegIds[override.wordIndex];
        if (!segId) continue;
        const seg = newSegments.get(segId);
        if (!seg) continue;

        const style: Partial<CaptionStyle> = { ...seg.style };
        if (override.x !== undefined) style.x = override.x;
        if (override.y !== undefined) style.y = override.y;
        if (override.scale !== undefined) { style.scaleX = override.scale; style.scaleY = override.scale; }
        if (override.rotation !== undefined) style.rotation = override.rotation;
        if (override.color !== undefined) style.color = override.color;
        if (override.opacity !== undefined) style.opacity = override.opacity;
        if (override.fontSize !== undefined) style.fontSize = override.fontSize;
        if (override.fontWeight !== undefined) style.fontWeight = override.fontWeight;
        if (override.fontFamily !== undefined) style.fontFamily = override.fontFamily;

        newSegments.set(segId, { ...seg, style });
      }

      useCaptionStore.getState().setModel({ ...model, segments: newSegments });
    } catch {
      // No overrides file
    }
  }, []);

  return { save, loadOverrides };
}
