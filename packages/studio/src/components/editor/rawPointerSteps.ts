// pointermove runs in the task that draws the frame; pointerrawupdate fires before it, in its own task.
const armed = new WeakMap<object, (event: Event) => void>();

const rawPointerStepsSupported = () =>
  typeof window !== "undefined" && "onpointerrawupdate" in window;

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
