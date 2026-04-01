import { create } from "zustand";
import {
  CaptionAnimation,
  CaptionAnimationSet,
  CaptionContainerStyle,
  CaptionModel,
  CaptionStyle,
} from "./types";

interface CaptionState {
  isEditMode: boolean;
  model: CaptionModel | null;
  selectedSegmentIds: Set<string>;
  selectedGroupId: string | null;
  sourceFilePath: string | null;

  // Basic
  setEditMode: (active: boolean) => void;
  setModel: (model: CaptionModel | null) => void;
  setSourceFilePath: (path: string | null) => void;

  // Selection
  selectSegment: (id: string, additive?: boolean) => void;
  selectGroup: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;

  // Segment mutations
  updateSegmentStyle: (segmentId: string, style: Partial<CaptionStyle>) => void;
  updateSegmentText: (segmentId: string, text: string) => void;
  updateSegmentTiming: (segmentId: string, start: number, end: number) => void;

  // Group mutations
  updateGroupStyle: (groupId: string, style: Partial<CaptionStyle>) => void;
  updateGroupContainer: (groupId: string, container: Partial<CaptionContainerStyle>) => void;
  updateGroupAnimation: (
    groupId: string,
    phase: keyof CaptionAnimationSet,
    animation: Partial<CaptionAnimation>,
  ) => void;
  splitGroup: (groupId: string, atSegmentId: string) => void;
  mergeGroups: (groupId1: string, groupId2: string) => void;

  // Bulk
  updateSelectedStyle: (style: Partial<CaptionStyle>) => void;
  applyAnimationToAll: (animation: CaptionAnimationSet) => void;

  // Reset
  reset: () => void;
}

const initialState = {
  isEditMode: false,
  model: null,
  selectedSegmentIds: new Set<string>(),
  selectedGroupId: null,
  sourceFilePath: null,
};

export const useCaptionStore = create<CaptionState>((set, get) => ({
  ...initialState,

  // Basic
  setEditMode: (active) => set({ isEditMode: active }),
  setModel: (model) => set({ model }),
  setSourceFilePath: (path) => set({ sourceFilePath: path }),

  // Selection
  selectSegment: (id, additive = false) =>
    set((state) => {
      if (additive) {
        const next = new Set(state.selectedSegmentIds);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return { selectedSegmentIds: next, selectedGroupId: null };
      }
      return { selectedSegmentIds: new Set([id]), selectedGroupId: null };
    }),

  selectGroup: (id) =>
    set((state) => {
      const group = state.model?.groups.get(id);
      if (!group) return {};
      return {
        selectedSegmentIds: new Set(group.segmentIds),
        selectedGroupId: id,
      };
    }),

  selectAll: () =>
    set((state) => {
      if (!state.model) return {};
      return {
        selectedSegmentIds: new Set(state.model.segments.keys()),
        selectedGroupId: null,
      };
    }),

  clearSelection: () => set({ selectedSegmentIds: new Set(), selectedGroupId: null }),

  // Segment mutations
  updateSegmentStyle: (segmentId, style) =>
    set((state) => {
      if (!state.model) return {};
      const segment = state.model.segments.get(segmentId);
      if (!segment) return {};
      const segments = new Map(state.model.segments);
      segments.set(segmentId, { ...segment, style: { ...segment.style, ...style } });
      return { model: { ...state.model, segments } };
    }),

  updateSegmentText: (segmentId, text) =>
    set((state) => {
      if (!state.model) return {};
      const segment = state.model.segments.get(segmentId);
      if (!segment) return {};
      const segments = new Map(state.model.segments);
      segments.set(segmentId, { ...segment, text });
      return { model: { ...state.model, segments } };
    }),

  updateSegmentTiming: (segmentId, start, end) =>
    set((state) => {
      if (!state.model) return {};
      const segment = state.model.segments.get(segmentId);
      if (!segment) return {};
      const segments = new Map(state.model.segments);
      segments.set(segmentId, { ...segment, start, end });
      return { model: { ...state.model, segments } };
    }),

  // Group mutations
  updateGroupStyle: (groupId, style) =>
    set((state) => {
      if (!state.model) return {};
      const group = state.model.groups.get(groupId);
      if (!group) return {};
      const groups = new Map(state.model.groups);
      groups.set(groupId, { ...group, style: { ...group.style, ...style } });
      return { model: { ...state.model, groups } };
    }),

  updateGroupContainer: (groupId, container) =>
    set((state) => {
      if (!state.model) return {};
      const group = state.model.groups.get(groupId);
      if (!group) return {};
      const groups = new Map(state.model.groups);
      groups.set(groupId, {
        ...group,
        containerStyle: { ...group.containerStyle, ...container },
      });
      return { model: { ...state.model, groups } };
    }),

  updateGroupAnimation: (groupId, phase, animation) =>
    set((state) => {
      if (!state.model) return {};
      const group = state.model.groups.get(groupId);
      if (!group) return {};
      const groups = new Map(state.model.groups);
      const existingPhase = group.animation[phase];
      const mergedPhase =
        existingPhase !== null
          ? { ...existingPhase, ...animation }
          : (animation as CaptionAnimation);
      groups.set(groupId, {
        ...group,
        animation: { ...group.animation, [phase]: mergedPhase },
      });
      return { model: { ...state.model, groups } };
    }),

  splitGroup: (groupId, atSegmentId) =>
    set((state) => {
      if (!state.model) return {};
      const group = state.model.groups.get(groupId);
      if (!group) return {};

      const splitIndex = group.segmentIds.indexOf(atSegmentId);
      if (splitIndex <= 0) return {};

      const firstIds = group.segmentIds.slice(0, splitIndex);
      const secondIds = group.segmentIds.slice(splitIndex);

      const newGroupId = `group-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const groups = new Map(state.model.groups);
      groups.set(groupId, { ...group, segmentIds: firstIds });
      groups.set(newGroupId, { ...group, id: newGroupId, segmentIds: secondIds });

      const orderIndex = state.model.groupOrder.indexOf(groupId);
      const groupOrder = [...state.model.groupOrder];
      groupOrder.splice(orderIndex + 1, 0, newGroupId);

      // Update groupIndex for segments in the new second group
      const segments = new Map(state.model.segments);
      secondIds.forEach((segId, idx) => {
        const seg = segments.get(segId);
        if (seg) {
          segments.set(segId, { ...seg, groupIndex: idx });
        }
      });

      return { model: { ...state.model, groups, segments, groupOrder } };
    }),

  mergeGroups: (groupId1, groupId2) =>
    set((state) => {
      if (!state.model) return {};
      const group1 = state.model.groups.get(groupId1);
      const group2 = state.model.groups.get(groupId2);
      if (!group1 || !group2) return {};

      const mergedSegmentIds = [...group1.segmentIds, ...group2.segmentIds];

      const groups = new Map(state.model.groups);
      groups.set(groupId1, { ...group1, segmentIds: mergedSegmentIds });
      groups.delete(groupId2);

      const groupOrder = state.model.groupOrder.filter((id) => id !== groupId2);

      // Update groupIndex for segments from group2
      const segments = new Map(state.model.segments);
      group2.segmentIds.forEach((segId, idx) => {
        const seg = segments.get(segId);
        if (seg) {
          segments.set(segId, { ...seg, groupIndex: group1.segmentIds.length + idx });
        }
      });

      // Clear selection if it referenced group2
      const selectedGroupId = get().selectedGroupId === groupId2 ? null : get().selectedGroupId;

      return { model: { ...state.model, groups, segments, groupOrder }, selectedGroupId };
    }),

  // Bulk
  updateSelectedStyle: (style) =>
    set((state) => {
      if (!state.model || state.selectedSegmentIds.size === 0) return {};
      const segments = new Map(state.model.segments);
      for (const segmentId of state.selectedSegmentIds) {
        const segment = segments.get(segmentId);
        if (segment) {
          segments.set(segmentId, { ...segment, style: { ...segment.style, ...style } });
        }
      }
      return { model: { ...state.model, segments } };
    }),

  applyAnimationToAll: (animation) =>
    set((state) => {
      if (!state.model) return {};
      const groups = new Map(state.model.groups);
      for (const [id, group] of groups) {
        groups.set(id, { ...group, animation });
      }
      return { model: { ...state.model, groups } };
    }),

  // Reset
  reset: () =>
    set({
      ...initialState,
      selectedSegmentIds: new Set<string>(),
    }),
}));
