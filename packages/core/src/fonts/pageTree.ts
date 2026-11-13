import { parseHTML } from "linkedom";

export type PageDocument = ReturnType<typeof parseHTML>["document"];

/** The tree of the page the font step read last, so its readers share one parse of it. */
let lastPage: { html: string; document: PageDocument } | undefined;

export function readPage(html: string): PageDocument {
  if (lastPage?.html === html) return lastPage.document;
  const { document } = parseHTML(html);
  lastPage = { html, document };
  return document;
}

/** The page's tree for a step that edits it: handed over, and no longer the page the readers share. */
export function takePage(html: string): PageDocument {
  const document = readPage(html);
  lastPage = undefined;
  return document;
}

/** The tree handed out was edited: it no longer reads as the page it came from. */
export function forgetPage(): void {
  lastPage = undefined;
}
