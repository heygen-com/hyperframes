export class NavigationDeadlineError extends Error {
  constructor(
    readonly cause: unknown,
    readonly webglObserved: boolean,
  ) {
    super("capture navigation timed out");
    this.name = "NavigationDeadlineError";
  }
}
