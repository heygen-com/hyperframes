// pointermove runs in the task that paints the frame, so a sealed step sent from it reaches the preview after
// that paint; pointerrawupdate fires in its own task, before it.

const armed = new WeakMap<object, (event: Event) => void>();

const rawPointerStepsSupported = () =>
  typeof window !== "undefined" && "onpointerrawupdate" in window;

/** Calls `onStep` for each raw pointer update until it returns false, once per `key` however often armed. */
export function armRawPointerSteps(key: object, onStep: (event: PointerEvent) => boolean): void {
  if (armed.has(key) || !rawPointerStepsSupported()) return;
  const listener = (event: Event) => {
    if (onStep(event as PointerEvent)) return;
    window.removeEventListener("pointerrawupdate", listener);
    armed.delete(key);
  };
  armed.set(key, listener);
  window.addEventListener("pointerrawupdate", listener);
}
