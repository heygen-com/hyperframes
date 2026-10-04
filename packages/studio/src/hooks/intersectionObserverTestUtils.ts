// Test-only IntersectionObserver stand-in: everything observed is reported near the screen, asynchronously.
export class NearScreenIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element) {
    queueMicrotask(() =>
      this.callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      ),
    );
  }

  unobserve() {}

  disconnect() {}
}
