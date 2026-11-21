import { previewChangesOutsideTextSaves } from "../player/previewReloading";

let lastOrder = 0;
/** Numbers a text save when the user asks for it, so the newest request wins for its target. */
export const nextTextSaveOrder = (): number => ++lastOrder;

const requested = new WeakMap<object, number>();
/** Tags a save with its number, taken now (at the request) unless one was taken earlier. */
export function orderedSave<T extends object>(save: T, order = nextTextSaveOrder()): T {
  requested.set(save, order);
  return save;
}
export const requestedOrder = (save: object): number | undefined => requested.get(save);

export interface LandedText {
  number: number;
  markup: string;
  changes: number;
}

/** Per file target: the newest text save that reached the file, and how many writes to it are running. */
export interface TextTargets {
  landed: Map<string, LandedText>;
  writing: Map<string, number>;
}

const targetOf = new WeakMap<HTMLElement, { targets: TextTargets; key: string }>();

export function rememberTextTarget(element: HTMLElement, targets: TextTargets, key: string): void {
  targetOf.set(element, { targets, key });
}

/** What the file holds for this canvas element's target, if a save reached it since the preview last changed. */
export function landedTextFor(element: HTMLElement): string | undefined {
  const target = targetOf.get(element);
  const last = target?.targets.landed.get(target.key);
  return last?.changes === previewChangesOutsideTextSaves() ? last.markup : undefined;
}

export function isTextTargetWriting(element: HTMLElement): boolean {
  const target = targetOf.get(element);
  return (target?.targets.writing.get(target.key) ?? 0) > 0;
}
