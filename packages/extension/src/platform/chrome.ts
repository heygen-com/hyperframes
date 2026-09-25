export interface ChromeTab {
  id?: number;
  windowId: number;
  active: boolean;
  url?: string;
}

export interface ChromeMessageSender {
  tab?: ChromeTab;
  frameId?: number;
  url?: string;
  documentId?: string;
}

interface ChromeEvent<Listener extends (...args: never[]) => unknown> {
  addListener(listener: Listener): void;
  removeListener(listener: Listener): void;
}

interface ChromeApi {
  runtime: {
    getURL(path: string): string;
    getContexts(filter: { contextTypes: string[]; documentUrls: string[] }): Promise<unknown[]>;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: ChromeEvent<
      (
        message: unknown,
        sender: ChromeMessageSender,
        respond: (response: unknown) => void,
      ) => boolean | void
    >;
  };
  scripting: {
    executeScript(details: { target: { tabId: number }; files: string[] }): Promise<unknown[]>;
  };
  tabs: {
    query(query: { active: boolean; currentWindow: boolean }): Promise<ChromeTab[]>;
    get(tabId: number): Promise<ChromeTab>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
    captureVisibleTab(windowId: number, options: { format: "png" }): Promise<string>;
    onActivated: ChromeEvent<(info: { tabId: number; windowId: number }) => void>;
    onUpdated: ChromeEvent<
      (tabId: number, change: { status?: string; url?: string }, tab: ChromeTab) => void
    >;
  };
  offscreen: {
    createDocument(details: {
      url: string;
      reasons: ["CLIPBOARD"];
      justification: string;
    }): Promise<void>;
  };
}

declare global {
  const chrome: ChromeApi;
}
