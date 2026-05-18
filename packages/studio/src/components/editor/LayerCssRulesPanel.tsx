import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useStudioContext } from "../../contexts/StudioContext";
import { useDomEditContext } from "../../contexts/DomEditContext";
import { useFileManagerContext } from "../../contexts/FileManagerContext";
import {
  denormalizeAuthoredCssRuleText,
  findAuthoredCssRulesInHtml,
  getAuthoredCssSelectorCandidates,
  measureAuthoredCssRuleContinuationIndent,
  normalizeAuthoredCssRuleText,
} from "../../utils/authoredCssRules";

type AuthoredCssEditorState =
  | {
      status: "idle" | "loading";
      sourceFile: string | null;
      message: string | null;
      rules: AuthoredCssEditorRule[];
    }
  | {
      status: "ready" | "error";
      sourceFile: string;
      message: string | null;
      rules: AuthoredCssEditorRule[];
    };

interface AuthoredCssEditorRule {
  selectorText: string;
  continuationIndent: string;
  originalRuleText: string;
  draftRuleText: string;
  status: "ready" | "saving" | "error";
  message: string | null;
}

export const LayerCssRulesPanel = memo(function LayerCssRulesPanel() {
  const { activeCompPath, refreshKey } = useStudioContext();
  const { domEditSelection, handleDomAuthoredCssRuleCommit } = useDomEditContext();
  const { readProjectFile } = useFileManagerContext();

  const [authoredCss, setAuthoredCss] = useState<AuthoredCssEditorState>({
    status: "idle",
    sourceFile: null,
    message: "Select a layer to inspect its authored CSS rules.",
    rules: [],
  });
  const authoredCssRequestRef = useRef(0);
  const authoredCssSaveRef = useRef(0);

  useEffect(() => {
    if (!domEditSelection) {
      authoredCssRequestRef.current += 1;
      authoredCssSaveRef.current = 0;
      setAuthoredCss({
        status: "idle",
        sourceFile: null,
        message: "Select a layer to inspect its authored CSS rules.",
        rules: [],
      });
      return;
    }

    const selectors = getAuthoredCssSelectorCandidates(domEditSelection);
    const sourceFile = domEditSelection.sourceFile || activeCompPath || "index.html";
    if (selectors.length === 0) {
      authoredCssRequestRef.current += 1;
      authoredCssSaveRef.current = 0;
      setAuthoredCss({
        status: "idle",
        sourceFile,
        message: "Only rules targeting this layer by exact #id or .class are supported here.",
        rules: [],
      });
      return;
    }

    const requestId = authoredCssRequestRef.current + 1;
    authoredCssRequestRef.current = requestId;
    authoredCssSaveRef.current = 0;
    setAuthoredCss({
      status: "loading",
      sourceFile,
      message: null,
      rules: [],
    });

    void readProjectFile(sourceFile)
      .then((html) => {
        if (authoredCssRequestRef.current !== requestId) return;
        const matches = findAuthoredCssRulesInHtml(html, selectors);
        if (matches.length === 0) {
          setAuthoredCss({
            status: "idle",
            sourceFile,
            message: `No authored rule found for ${selectors.join(" or ")}.`,
            rules: [],
          });
          return;
        }
        setAuthoredCss({
          status: "ready",
          sourceFile,
          message: null,
          rules: matches.map((match) => ({
            selectorText: match.selectorText,
            continuationIndent: match.continuationIndent,
            originalRuleText: match.ruleText,
            draftRuleText: normalizeAuthoredCssRuleText(match),
            status: "ready",
            message: null,
          })),
        });
      })
      .catch((error) => {
        if (authoredCssRequestRef.current !== requestId) return;
        setAuthoredCss({
          status: "error",
          sourceFile,
          message: error instanceof Error ? error.message : "Failed to load CSS rule.",
          rules: [],
        });
      });
  }, [activeCompPath, domEditSelection, readProjectFile, refreshKey]);

  const handleAuthoredCssDraftChange = useCallback((ruleIndex: number, draftRuleText: string) => {
    setAuthoredCss((current) => {
      if (current.status !== "ready" && current.status !== "error") return current;
      return {
        ...current,
        rules: current.rules.map((rule, index) =>
          index !== ruleIndex
            ? rule
            : {
                ...rule,
                draftRuleText,
                status: rule.status === "error" ? "ready" : rule.status,
                message: null,
              },
        ),
      };
    });
  }, []);

  const handleAuthoredCssReset = useCallback((ruleIndex: number) => {
    setAuthoredCss((current) => {
      if (current.status !== "ready" && current.status !== "error") return current;
      return {
        ...current,
        rules: current.rules.map((rule, index) =>
          index !== ruleIndex
            ? rule
            : {
                ...rule,
                draftRuleText: normalizeAuthoredCssRuleText({
                  selectorText: rule.selectorText,
                  ruleText: rule.originalRuleText,
                  start: 0,
                  end: rule.originalRuleText.length,
                  sourceStart: 0,
                  continuationIndent: rule.continuationIndent,
                }),
                status: "ready",
                message: null,
              },
        ),
      };
    });
  }, []);

  const handleAuthoredCssSave = useCallback(
    (ruleIndex: number) => {
      if (!domEditSelection) return;
      if (authoredCss.status !== "ready" && authoredCss.status !== "error") return;

      const rule = authoredCss.rules[ruleIndex];
      if (!rule) return;

      const nextRuleText = denormalizeAuthoredCssRuleText(rule.draftRuleText, {
        selectorText: rule.selectorText,
        ruleText: rule.originalRuleText,
        start: 0,
        end: rule.originalRuleText.length,
        sourceStart: 0,
        continuationIndent: rule.continuationIndent,
      });
      const requestId = authoredCssRequestRef.current;
      const saveId = authoredCssSaveRef.current + 1;
      authoredCssSaveRef.current = saveId;
      const selection = domEditSelection;

      setAuthoredCss((current) => {
        if (current.status !== "ready" && current.status !== "error") return current;
        return {
          ...current,
          rules: current.rules.map((currentRule, index) =>
            index !== ruleIndex
              ? currentRule
              : {
                  ...currentRule,
                  status: "saving",
                  message: null,
                },
          ),
        };
      });

      void handleDomAuthoredCssRuleCommit(selection, ruleIndex, nextRuleText)
        .then(() => {
          setAuthoredCss((current) => {
            if (
              authoredCssRequestRef.current !== requestId ||
              authoredCssSaveRef.current !== saveId
            )
              return current;
            if (current.status !== "ready" && current.status !== "error") return current;

            return {
              ...current,
              rules: current.rules.map((currentRule, index) => {
                if (index !== ruleIndex) return currentRule;
                const continuationIndent = measureAuthoredCssRuleContinuationIndent(nextRuleText);
                return {
                  ...currentRule,
                  continuationIndent,
                  originalRuleText: nextRuleText,
                  draftRuleText: normalizeAuthoredCssRuleText({
                    selectorText: currentRule.selectorText,
                    ruleText: nextRuleText,
                    start: 0,
                    end: nextRuleText.length,
                    sourceStart: 0,
                    continuationIndent,
                  }),
                  status: "ready",
                  message: null,
                };
              }),
            };
          });
        })
        .catch((error) => {
          setAuthoredCss((current) => {
            if (
              authoredCssRequestRef.current !== requestId ||
              authoredCssSaveRef.current !== saveId
            )
              return current;
            if (current.status !== "ready" && current.status !== "error") return current;

            return {
              ...current,
              status: "error",
              rules: current.rules.map((currentRule, index) =>
                index !== ruleIndex
                  ? currentRule
                  : {
                      ...currentRule,
                      status: "error",
                      message: error instanceof Error ? error.message : "Failed to save CSS rule.",
                    },
              ),
            };
          });
        });
    },
    [authoredCss, domEditSelection, handleDomAuthoredCssRuleCommit],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-neutral-950">
      <div className="border-b border-white/10 px-3 py-2">
        <div className="text-[11px] font-medium text-neutral-200">Authored CSS</div>
        <div className="truncate text-[10px] text-neutral-500">
          {authoredCss.sourceFile ?? domEditSelection?.sourceFile ?? activeCompPath ?? "index.html"}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {authoredCss.status === "ready" || authoredCss.status === "error" ? (
          <div className="space-y-3">
            {authoredCss.rules.length === 0 ? (
              <p className="text-[11px] leading-5 text-neutral-500">
                {authoredCss.message ?? "No authored CSS rule is available for this layer."}
              </p>
            ) : (
              authoredCss.rules.map((rule, ruleIndex) => {
                const dirty =
                  rule.draftRuleText !==
                  normalizeAuthoredCssRuleText({
                    selectorText: rule.selectorText,
                    ruleText: rule.originalRuleText,
                    start: 0,
                    end: rule.originalRuleText.length,
                    sourceStart: 0,
                    continuationIndent: rule.continuationIndent,
                  });

                return (
                  <div
                    key={`${rule.selectorText}:${ruleIndex}`}
                    className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-mono text-[10px] text-neutral-400">
                        {rule.selectorText}
                      </div>
                      <div className="text-[10px] text-neutral-600">Rule {ruleIndex + 1}</div>
                    </div>
                    <textarea
                      value={rule.draftRuleText}
                      onChange={(event) =>
                        handleAuthoredCssDraftChange(ruleIndex, event.target.value)
                      }
                      spellCheck={false}
                      className="min-h-[160px] w-full resize-y rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-[11px] leading-5 text-neutral-100 outline-none"
                    />
                    <div
                      className={`flex items-center gap-3 ${
                        rule.message ? "justify-between" : "justify-end"
                      }`}
                    >
                      {rule.message ? (
                        <p className="min-h-[16px] text-[11px] leading-4 text-neutral-500">
                          {rule.message}
                        </p>
                      ) : null}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleAuthoredCssReset(ruleIndex)}
                          disabled={!dirty || rule.status === "saving"}
                          className="h-8 rounded-xl border border-neutral-700 bg-neutral-950 px-3 text-[11px] font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Reset
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAuthoredCssSave(ruleIndex)}
                          disabled={!dirty || rule.status === "saving"}
                          className="h-8 rounded-xl border border-studio-accent/40 bg-studio-accent/12 px-3 text-[11px] font-medium text-studio-accent transition-colors hover:bg-studio-accent/18 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {rule.status === "saving" ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : authoredCss.status === "loading" ? (
          <p className="text-[11px] leading-5 text-neutral-500">Loading authored CSS rules...</p>
        ) : (
          <p className="text-[11px] leading-5 text-neutral-500">
            {authoredCss.message ?? "No authored CSS rule is available for this layer."}
          </p>
        )}
      </div>
    </div>
  );
});
