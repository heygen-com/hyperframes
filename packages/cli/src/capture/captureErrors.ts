export class NavigationDeadlineError extends Error {
  constructor(readonly cause: unknown) {
    super("capture navigation timed out");
    this.name = "NavigationDeadlineError";
  }
}
