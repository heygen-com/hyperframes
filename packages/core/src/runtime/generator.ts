export interface SceneRunnerOptions {
  timeline: any; // A GSAP timeline or similar interface
}

/**
 * Executes a generator function to build a deterministic GSAP timeline.
 * Since Hyperframes requires arbitrary deterministic seeking (e.g., skip to frame 500),
 * we evaluate the generator completely upfront, translating yield* operations into GSAP tweens.
 */
export class SceneRunner {
  private timeline: any;
  private currentTime: number = 0;

  constructor(options: SceneRunnerOptions) {
    this.timeline = options.timeline;
  }

  /**
   * Fast-forwards the execution of the generator deterministically to build the timeline.
   *
   * Timeline cursor semantics:
   * - `currentTime` always points to the END of the last placed tween (or delay).
   * - `offsetSeconds` shifts where the NEW tween is placed relative to `currentTime`.
   *   Positive = gap after previous, negative = overlap with previous.
   * - After placing a tween, `currentTime` advances to the tween's end time:
   *   `currentTime + offsetSeconds + durationSeconds`.
   */
  public execute(generator: Generator<any, void, any>): void {
    let result = generator.next();

    while (!result.done) {
      const instruction = result.value;

      if (instruction && instruction.type === "animate") {
        const { target, props, durationSeconds, offsetSeconds = 0 } = instruction;

        // Place tween at currentTime + offset
        const startPosition = this.currentTime + offsetSeconds;

        this.timeline.to(
          target,
          {
            ...props,
            duration: durationSeconds,
          },
          startPosition,
        );

        // Advance cursor to the END of this tween
        this.currentTime = startPosition + durationSeconds;
      } else if (instruction && instruction.type === "delay") {
        this.currentTime += instruction.durationSeconds;
      } else {
        // Unknown yield, assume 0 duration
      }

      result = generator.next();
    }
  }

  /**
   * Cleans up the GSAP timeline to prevent memory leaks when the scene is destroyed.
   */
  public destroy(): void {
    if (this.timeline) {
      if (typeof this.timeline.kill === "function") {
        this.timeline.kill();
      } else if (typeof this.timeline.clear === "function") {
        this.timeline.clear();
      }
      this.timeline = null;
    }
  }
}

// Helpers for the user to yield
export function animate(target: any, props: any, durationSeconds: number, offsetSeconds = 0) {
  return {
    type: "animate",
    target,
    props,
    durationSeconds,
    offsetSeconds,
  };
}

export function delay(durationSeconds: number) {
  return {
    type: "delay",
    durationSeconds,
  };
}
