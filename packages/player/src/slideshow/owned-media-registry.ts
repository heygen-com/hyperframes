export type OwnedMediaEntry = {
  key: string;
  el: HTMLMediaElement;
};

type MediaBinding = {
  key: string;
  controller: AbortController;
};

/**
 * Owns the media event listeners and imperative mutations for one slideshow.
 * A WeakMap ties each listener lifetime to its media element while the Set
 * provides the bounded iteration needed for mute, pause, and deterministic
 * teardown. No marker attributes leak ownership into shared DOM.
 */
export class OwnedMediaRegistry<Action extends string> {
  private bindings = new WeakMap<HTMLMediaElement, MediaBinding>();
  private owned = new Set<HTMLMediaElement>();

  constructor(
    private readonly actions: readonly Action[],
    private readonly onAction: (el: HTMLMediaElement, key: string, action: Action) => void,
  ) {}

  sync(entries: readonly OwnedMediaEntry[]): HTMLMediaElement[] {
    const next = new Set<HTMLMediaElement>();
    const added: HTMLMediaElement[] = [];
    for (const { key, el } of entries) {
      next.add(el);
      const binding = this.bindings.get(el);
      if (binding?.key === key) continue;
      binding?.controller.abort();

      const AbortControllerCtor = el.ownerDocument.defaultView?.AbortController ?? AbortController;
      const controller = new AbortControllerCtor();
      this.bindings.set(el, { key, controller });
      added.push(el);
      for (const action of this.actions) {
        el.addEventListener(action, () => this.onAction(el, key, action), {
          signal: controller.signal,
        });
      }
    }

    for (const el of this.owned) {
      if (next.has(el)) continue;
      this.bindings.get(el)?.controller.abort();
      this.bindings.delete(el);
    }
    this.owned = next;
    return added;
  }

  setMuted(muted: boolean): void {
    for (const el of this.owned) {
      el.muted = muted || el.defaultMuted;
    }
  }

  pauseAll(): void {
    for (const el of this.owned) {
      el.pause();
    }
  }

  clear(): void {
    for (const el of this.owned) {
      this.bindings.get(el)?.controller.abort();
    }
    this.owned.clear();
    this.bindings = new WeakMap();
  }
}
