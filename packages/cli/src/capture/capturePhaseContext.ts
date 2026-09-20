import type { Browser, Page } from "puppeteer-core";

export interface PhaseContext {
  page1: Page;
  chromeBrowser: Browser;
  [key: string]: unknown;
}
