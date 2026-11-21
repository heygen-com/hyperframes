// previewAnswer over a mocked request, as the channel runs it: the send gate's admit, then the request.
export function admittedAnswer(request: (...args: unknown[]) => unknown, stale: symbol) {
  return (...args: unknown[]) => {
    const admit = args[4] as (() => boolean) | undefined;
    if (admit && !admit()) return Promise.resolve(stale);
    return request(...args.slice(0, 4));
  };
}
