export type HyperframePickerBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type HyperframePickerElementInfo = {
  id: string | null;
  tagName: string;
  selector: string;
  label: string;
  boundingBox: HyperframePickerBoundingBox;
  textContent: string | null;
  src: string | null;
  dataAttributes: Record<string, string>;
};

export type HyperframePickerApi = {
  enable: () => void;
  disable: () => void;
  isActive: () => boolean;
  getHovered: () => HyperframePickerElementInfo | null;
  getSelected: () => HyperframePickerElementInfo | null;
  getCandidatesAtPoint: (
    clientX: number,
    clientY: number,
    limit?: number,
  ) => HyperframePickerElementInfo[];
  pickAtPoint: (
    clientX: number,
    clientY: number,
    index?: number,
  ) => HyperframePickerElementInfo | null;
  pickManyAtPoint: (
    clientX: number,
    clientY: number,
    indexes?: number[],
  ) => HyperframePickerElementInfo[];
};

declare global {
  interface Window {
    __HF_PICKER_API?: HyperframePickerApi;
  }
}
