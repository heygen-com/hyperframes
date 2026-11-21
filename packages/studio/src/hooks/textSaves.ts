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

let epoch = 0;
const landed = new WeakMap<HTMLElement, { order: number; html: string; epoch: number }>();
const saving = new WeakMap<HTMLElement, number>();

/** The markup of the newest save of this canvas element that reached the file, unless something else wrote since. */
export function landedText(element: HTMLElement): string | undefined {
  const last = landed.get(element);
  return last?.epoch === epoch ? last.html : undefined;
}

export function textSaveLanded(element: HTMLElement, order: number, html: string): void {
  const last = landed.get(element);
  if (last?.epoch === epoch && last.order > order) return;
  landed.set(element, { order, html, epoch });
}

/** An undo, redo or reload wrote the file outside the text save pipeline: what landed before no longer shows. */
export function forgetLandedText(): void {
  epoch++;
}

export function textSaveStarted(element: HTMLElement): () => void {
  saving.set(element, (saving.get(element) ?? 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    saving.set(element, (saving.get(element) ?? 1) - 1);
  };
}

export const isTextSaving = (element: HTMLElement): boolean => (saving.get(element) ?? 0) > 0;
