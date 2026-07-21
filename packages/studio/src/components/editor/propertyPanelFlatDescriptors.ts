import type { ReactNode } from "react";
import type { resolveEditingSections } from "@hyperframes/core/editing";

export type EditingSections = ReturnType<typeof resolveEditingSections>;

export type FlatGroupDescriptor = {
  id: string;
  title: string;
  summary?: string;
  accessory?: ReactNode;
  content: ReactNode;
};

// FlatMotionSection never calls these while effect cards are hidden; they only
// provide its required callback shape on the gated-off path.
export const EMPTY_GSAP_EFFECT_HANDLERS = {
  onAddAnimation: () => {},
  onUpdateProperty: () => {},
  onUpdateMeta: () => {},
  onDeleteAnimation: () => {},
  onAddProperty: () => {},
  onRemoveProperty: () => {},
};
