/** The page the browser lands on after sign-in: one design for the CLI's three endings. */

const MARK_A =
  "M10.1851 57.8021L33.1145 73.8313C36.2202 75.9978 41.5173 73.5433 42.4816 69.4984L51.7611 30.4271C52.7253 26.3822 48.5802 23.9277 44.4602 26.0942L13.917 42.1235C6.96677 45.7676 4.97564 54.1579 10.1851 57.8021Z";
const MARK_B =
  "M87.5129 57.5141L56.9696 73.5433C52.8371 75.7098 48.7046 73.2553 49.6688 69.2104L58.9483 30.1391C59.9125 26.0942 65.2097 23.6397 68.3154 25.8062L91.2447 41.8354C96.4668 45.4796 94.4631 53.8699 87.5129 57.5141Z";

const STYLE = `:root{color-scheme:light dark;--bg:#f2f0ed;--ink:#1d1b18;--ink2:#5d5a55;--tile:#dff3ea;--tile-ink:#087a54;--bad:#fbe6e1;--bad-ink:#b3402e;--btn:#1d1b18;--btn-ink:#f2f0ed;--panel:#0c0c0e;--panel-ink:#f4f1ec}
@media(prefers-color-scheme:dark){:root{--bg:#201e1b;--ink:#f6f4f1;--ink2:#b5b1aa;--tile:#1f3a2f;--tile-ink:#37de91;--bad:#3a2420;--bad-ink:#f08a78;--btn:#f6f4f1;--btn-ink:#201e1b}}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--ink);font:400 15px/1.45 "TT Norms",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr)}
.col{position:relative;display:flex;flex-direction:column;justify-content:center;padding:48px 32px 48px max(32px,min(7vw,96px))}
.brand{position:absolute;top:28px;left:32px;display:flex;align-items:center;gap:10px;font-weight:600;font-size:20px;letter-spacing:-.01em}
.tile{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:var(--tile);color:var(--tile-ink);margin-bottom:20px}
.bad .tile{background:var(--bad);color:var(--bad-ink)}
h1{margin:0;font-size:30px;line-height:1.1;font-weight:600;letter-spacing:-.02em;text-wrap:balance}
p{margin:10px 0 0;color:var(--ink2);max-width:360px;text-wrap:pretty}
code{font:500 13px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink2)}
.panel{margin:14px;border-radius:24px;background:var(--panel);color:var(--panel-ink);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px}
.panel b{font-size:26px;font-weight:600;letter-spacing:-.01em}
.panel small{color:rgb(244 241 236/.58);font-size:14px;margin-top:-10px}
.badge{position:relative}
.chk{display:none;position:absolute;right:-8px;bottom:-4px;width:22px;height:22px;border-radius:50%;background:#37de91;place-items:center}
.ok .chk{display:grid}
@media(max-width:760px){body{grid-template-columns:1fr;grid-template-rows:auto auto}.col{padding:84px 24px 32px}.brand{left:24px}.panel{min-height:300px;margin:12px}}`;

const CHECK =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 12.5 4.2 4.2 8.8-9.4"/></svg>';
const CROSS =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>';

const CHK =
  '<span class="chk"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0e1a14" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 12.5 4 4 8-9"/></svg></span>';

function mark(width: number, height: number, id: string): string {
  const gradient = (suffix: string, x1: string, y1: string, x2: string, y2: string): string =>
    `<linearGradient id="${suffix}${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="#06E3FA"/><stop offset="1" stop-color="#4FDB5E"/></linearGradient>`;
  return `<svg viewBox="4 22 92 56" width="${width}" height="${height}" aria-hidden="true"><defs>${gradient("a", "48.57", "25", "44.78", "71.94")}${gradient("b", "54.83", "73.84", "72.1", "32.89")}</defs><path fill="url(#a${id})" d="${MARK_A}"/><path fill="url(#b${id})" d="${MARK_B}"/></svg>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(args: { ok: boolean; title: string; text: string; detail?: string }): string {
  const detail = args.detail ? `<p><code>${escapeHtml(args.detail)}</code></p>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(args.title)}</title><style>${STYLE}</style></head><body class="${args.ok ? "ok" : "bad"}"><main class="col"><div class="brand">${mark(38, 23, "c")}<span>HyperFrames</span></div><div class="tile">${args.ok ? CHECK : CROSS}</div><h1>${escapeHtml(args.title)}</h1><p>${escapeHtml(args.text)}</p>${detail}</main><aside class="panel"><div class="badge">${mark(96, 58, "p")}${CHK}</div><b>HyperFrames</b><small>by HeyGen</small></aside></body></html>`;
}

export function connectedPage(): string {
  return page({
    ok: true,
    title: "You're connected",
    text: "Return to your terminal. You can close this tab.",
  });
}

/** A Cancel says "Not authorized"; any other ending is a failure and says so. */
export function failurePage(code: string, description: string): string {
  if (code === "access_denied") {
    return page({
      ok: false,
      title: "Not authorized",
      text: "Nothing was connected. Run the login again from your terminal.",
    });
  }
  return page({
    ok: false,
    title: "Couldn't connect",
    text:
      description ||
      "Something went wrong on the way back. Run the login again from your terminal.",
    detail: code,
  });
}
