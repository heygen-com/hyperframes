import { useState, useEffect, useMemo } from "react";
import { Copy, Check } from "lucide-react";

interface HtmlPreviewProps {
  projectId: string;
  version: number;
}

function formatElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const attrs: string[] = [];

  for (const attr of el.attributes) {
    attrs.push(`${attr.name}="${attr.value}"`);
  }

  if (attrs.length === 0) return `<${tag} />`;

  // One attribute per line, indented
  return `<${tag}\n${attrs.map((a) => `  ${a}`).join("\n")}\n/>`;
}

function extractTimelineElements(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const els = doc.querySelectorAll("[data-start]");
  if (els.length === 0) return "<!-- No elements with data-start found -->";

  return Array.from(els).map(formatElement).join("\n\n");
}

export function HtmlPreview({ projectId, version }: HtmlPreviewProps) {
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/projects/${projectId}/preview-raw`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setRawHtml(text);
      })
      .catch(() => {
        if (!cancelled) setRawHtml(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId, version]);

  const filtered = useMemo(
    () => (rawHtml ? extractTimelineElements(rawHtml) : null),
    [rawHtml]
  );

  const handleCopy = async () => {
    if (!filtered) return;
    await navigator.clipboard.writeText(filtered);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 border-l border-neutral-200/80 bg-neutral-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-700/50">
        <span className="text-neutral-400 text-[10px] font-medium tracking-wide uppercase">
          Timeline Elements
        </span>
        <button
          onClick={handleCopy}
          className="p-1 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700/50 transition-colors"
          title="Copy HTML"
        >
          {copied ? (
            <Check className="w-3 h-3 text-green-400" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-neutral-500 text-xs">Loading...</div>
          </div>
        ) : (
          <pre className="text-[11px] leading-relaxed font-mono text-neutral-300 whitespace-pre-wrap break-words">
            {filtered ?? "<!-- Failed to load HTML -->"}
          </pre>
        )}
      </div>
    </div>
  );
}
