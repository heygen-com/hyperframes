export type TemplateId = "warm-grain" | "play-mode" | "swiss-grid" | "vignelli";

export interface TemplateOption {
  id: TemplateId;
  label: string;
  hint: string;
}

export const TEMPLATES: TemplateOption[] = [
  { id: "warm-grain", label: "Warm Grain", hint: "Cream aesthetic with grain texture" },
  { id: "play-mode", label: "Play Mode", hint: "Playful elastic animations" },
  { id: "swiss-grid", label: "Swiss Grid", hint: "Structured grid layout" },
  { id: "vignelli", label: "Vignelli", hint: "Bold typography with red accents" },
];
