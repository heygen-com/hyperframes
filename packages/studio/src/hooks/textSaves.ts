import type { TextWriteOrder } from "./domEditCommitRunner";
import { EDITING_REQUEST_TIMEOUT_MS } from "@hyperframes/core/runtime/editing-port";
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

/** What the file holds for a target, if a save reached it since the preview last changed. */
export function savedTextIn(targets: TextTargets, key: string): string | undefined {
  const last = targets.landed.get(key);
  return last?.changes === previewChangesOutsideTextSaves() ? last.markup : undefined;
}

export function landedTextFor(element: HTMLElement): string | undefined {
  const target = targetOf.get(element);
  return target && savedTextIn(target.targets, target.key);
}

export function isTextTargetWriting(element: HTMLElement): boolean {
  const target = targetOf.get(element);
  return (target?.targets.writing.get(target.key) ?? 0) > 0;
}

const queuedOn = new WeakMap<HTMLElement, Promise<unknown>>();

/** Holds a text save of `element` from its request until it settles; an edit opening on it waits for it. */
export function queueTextSave<T>(element: HTMLElement, saving: Promise<T>): Promise<T> {
  const all = Promise.allSettled([queuedOn.get(element), saving]);
  queuedOn.set(element, all);
  void all.then(() => queuedOn.get(element) === all && queuedOn.delete(element));
  return saving;
}

/** Resolves once the element's queued text saves settle, or after the frame's own request timeout. */
export function textSavesSettled(element: HTMLElement): Promise<void> | null {
  const queued = queuedOn.get(element);
  if (!queued) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    queued.then(() => {}),
    new Promise<void>((resolve) => (timer = setTimeout(resolve, EDITING_REQUEST_TIMEOUT_MS))),
  ]).finally(() => clearTimeout(timer));
}

/** A panel save is skipped only when a newer panel save targets the same field. */
export function fieldSave(newestOn: Map<string, number>, field: string, number: number) {
  let skipped = false;
  const newest = () => newestOn.get(field) === number;
  return {
    shouldSave: () => newest() || !(skipped = true),
    landed: () => !skipped,
    done: () => void (newest() && newestOn.delete(field)),
  };
}

export type TextSaveBookkeeping = {
  text: TextWriteOrder;
  /** The newest panel save per element field: an older one on the same field is superseded, another field's is not. */
  newestFieldSave: Map<string, number>;
  styleVersions: Map<string, symbol>;
};
