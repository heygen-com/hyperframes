import type { PausedVideoFrameProvider } from "@hyperframes/core";
import type { IframeWindow } from "./playbackTypes";

const installed = new WeakMap<
  HTMLIFrameElement,
  {
    document: Document;
    provider: PausedVideoFrameProvider;
    setter: (provider: PausedVideoFrameProvider | null) => void;
  }
>();

/** A lazy facade also installs in Studio's hidden reload frame before its first seek. */
export function attachPausedVideoProvider(iframe: HTMLIFrameElement, win: IframeWindow): void {
  if (!win.__hf?.setPausedVideoFrameProvider || !iframe.contentDocument) return;
  const previous = installed.get(iframe);
  const setter = win.__hf.setPausedVideoFrameProvider;
  if (previous?.document === iframe.contentDocument && previous.setter === setter) return;
  previous?.provider.dispose();
  let disposed = false;
  let decoder: Promise<PausedVideoFrameProvider> | null = null;
  const provider: PausedVideoFrameProvider = {
    async decode(requests, signal) {
      signal.throwIfAborted();
      if (disposed) throw new DOMException("Preview disposed", "AbortError");
      decoder ??= import("./pausedVideoDecoder").then(({ createPausedVideoDecoder }) =>
        createPausedVideoDecoder(iframe),
      );
      const actual = await decoder;
      if (disposed) {
        actual.dispose();
        throw new DOMException("Preview disposed", "AbortError");
      }
      return actual.decode(requests, signal);
    },
    async suspend() {
      const actual = await decoder?.catch(() => null);
      await actual?.suspend?.();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      void decoder?.then((actual) => actual.dispose()).catch(() => {});
      win.removeEventListener("pagehide", onPageHide);
    },
  };
  const onPageHide = () => {
    provider.dispose();
    installed.delete(iframe);
  };
  win.addEventListener("pagehide", onPageHide, { once: true });
  installed.set(iframe, { document: iframe.contentDocument, provider, setter });
  setter(provider);
}
