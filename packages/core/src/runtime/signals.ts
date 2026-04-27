export class Signal<T> {
  private _value: T;
  private listeners: Set<(value: T) => void> = new Set();

  constructor(initialValue: T) {
    this._value = initialValue;
  }

  get value(): T {
    return this._value;
  }

  set value(newValue: T) {
    this._value = newValue;
    this.notify();
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    listener(this._value);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this._value);
    }
  }
}

export function createSignal<T>(initialValue: T) {
  return new Signal<T>(initialValue);
}
