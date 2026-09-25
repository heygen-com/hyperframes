export class SerialClipboardWriter {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly write: (text: string) => Promise<void>) {}

  enqueue(text: string): Promise<void> {
    const run = this.tail.then(() => this.write(text));
    this.tail = run.catch(() => undefined);
    return run;
  }
}
