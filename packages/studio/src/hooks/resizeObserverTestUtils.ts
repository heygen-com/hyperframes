// Test-only ResizeObserver stand-in: a test delivers a size by hand with `reportResize`.
let resizeCallback: ResizeObserverCallback | null = null;

export function MockResizeObserver(callback: ResizeObserverCallback) {
  resizeCallback = callback;
  return { observe() {}, disconnect() {}, unobserve() {} };
}

export function reportResize(width: number, height: number): void {
  resizeCallback!(
    [{ contentRect: { width, height } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
}
