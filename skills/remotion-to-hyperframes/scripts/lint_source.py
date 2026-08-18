#!/usr/bin/env python3
"""Lint a Remotion project for patterns that don't translate cleanly to HyperFrames.

The skill should run this *before* attempting a translation. If any blocker
findings come back, the recommendation is to use the runtime interop pattern
from PR #214 instead of producing broken HTML.

Usage:
    lint_source.py <path-to-remotion-src> [--json]

Output (default human-readable, --json for machine-readable):
    For each .ts/.tsx file, a list of findings with:
      - severity: blocker | warning | info
      - line, column
      - rule id
      - message
      - recommendation

Blockers (skill should refuse to translate):
  - r2hf/use-state            React state machine drives animation
  - r2hf/use-effect-deps      useEffect/useLayoutEffect with non-empty deps (side effects)
  - r2hf/use-reducer          useReducer drives animation
  - r2hf/async-metadata       calculateMetadata returns a Promise
  - r2hf/third-party-react-ui Imports a React UI library (shadcn, mui, antd, mantine, chakra)

Warnings (translate but flag — drop the construct, keep the rest):
  - r2hf/lambda-import        @remotion/lambda configuration — drop, HF is single-machine
  - r2hf/delay-render         delayRender() — HF handles asset loading differently
  - r2hf/use-callback         useCallback — usually decorative, drop
  - r2hf/use-memo             useMemo — usually decorative, drop
  - r2hf/custom-hook          Custom hook (use*) defined locally; may need manual rewrite

Info (translate and document):
  - r2hf/static-file          staticFile("x") — convert to relative path
  - r2hf/interpolate-colors   interpolateColors — translate to GSAP color tween
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Iterable
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Callable

# Windows sizes stdio to the ANSI code page (cp1252), which cannot encode every glyph
# a finding message carries. These scripts emit UTF-8 on every platform; say so. Carry
# `errors` across: reconfigure() resets it to "strict", and CPython deliberately gives
# stderr "backslashreplace" so the diagnostic path can never itself raise — this script
# prints scanned filenames, and an unpaired surrogate in one would otherwise crash the
# reporter instead of being escaped.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors=_stream.errors)

BLOCKER = "blocker"
WARNING = "warning"
INFO = "info"

THIRD_PARTY_UI_PACKAGES = {
    "@mui/material",
    "@mui/icons-material",
    "@chakra-ui/react",
    "@mantine/core",
    "antd",
    "@shadcn/ui",
    "@radix-ui",
    "@nextui-org/react",
}


@dataclass
class Finding:
    file: str
    line: int
    column: int
    severity: str
    rule: str
    message: str
    recommendation: str


@dataclass
class Rule:
    """A lint rule: a matcher that yields hits, plus the metadata each hit gets.

    A matcher is a function `src -> Iterable[(offset, override_message)]`. If
    `override_message` is None, the rule's default `message` is used; matchers
    that need to embed the matched text (custom-hook name, third-party package
    name) return the customized message instead.
    """

    rule_id: str
    severity: str
    matcher: Callable[[str], Iterable[tuple[int, str | None]]]
    message: str
    recommendation: str


def _regex_matcher(pattern: re.Pattern[str]) -> Callable[[str], Iterable[tuple[int, str | None]]]:
    def _match(src: str) -> Iterable[tuple[int, str | None]]:
        for m in pattern.finditer(src):
            yield m.start(), None

    return _match


def _use_effect_with_deps(src: str) -> Iterable[tuple[int, str | None]]:
    # Find use(Layout)?Effect(, walk to its matching ), and check if the call
    # ends with `, [<non-empty>])`. Empty `[]` is mount-only, allowed.
    for m in re.finditer(r"\buse(?:Layout)?Effect\s*\(", src):
        end = _find_matching_paren(src, m.end() - 1)
        if end is None:
            continue
        call = src[m.start() : end + 1]
        m2 = re.search(r",\s*\[([^\]]*)\]\s*$", call[:-1])
        if m2 and m2.group(1).strip():
            yield m.start(), None


_CUSTOM_HOOK_DECL = re.compile(
    r"^\s*(?:export\s+(?:default\s+)?)?(?:function|const|let|var)\s+(use[A-Z]\w+)\b",
    re.MULTILINE,
)
_REMOTION_BUILTIN_HOOKS = {"useCurrentFrame", "useVideoConfig"}


def _custom_hook(src: str) -> Iterable[tuple[int, str | None]]:
    for m in _CUSTOM_HOOK_DECL.finditer(src):
        name = m.group(1)
        if name in _REMOTION_BUILTIN_HOOKS:
            continue
        yield m.start(), f"Custom hook `{name}` defined locally — may need manual rewrite"


_IMPORT_FROM = re.compile(r"from\s+['\"]([^'\"]+)['\"]")


def _third_party_react_ui(src: str) -> Iterable[tuple[int, str | None]]:
    for m in _IMPORT_FROM.finditer(src):
        pkg = m.group(1)
        if any(pkg.startswith(p) for p in THIRD_PARTY_UI_PACKAGES):
            yield m.start(), f"Imports `{pkg}` — third-party React UI library has no HF equivalent"


RULES: list[Rule] = [
    Rule(
        "r2hf/use-state",
        BLOCKER,
        _regex_matcher(re.compile(r"\buseState\s*[(<]")),
        "useState detected — Remotion compositions that drive animation via React state are not deterministic frame-capture targets in HyperFrames",
        "Use the runtime interop pattern from PR #214 instead of attempting a translation",
    ),
    Rule(
        "r2hf/use-reducer",
        BLOCKER,
        _regex_matcher(re.compile(r"\buseReducer\s*[(<]")),
        "useReducer detected — same issue as useState",
        "Use the runtime interop pattern from PR #214",
    ),
    Rule(
        "r2hf/use-effect-deps",
        BLOCKER,
        _use_effect_with_deps,
        "useEffect/useLayoutEffect with non-empty deps — side effects don't translate to HF's seek-driven model",
        "Move the side-effect work into a build step, or use the runtime interop pattern",
    ),
    Rule(
        "r2hf/async-metadata",
        BLOCKER,
        _regex_matcher(
            re.compile(
                r"calculateMetadata[^=]*=\s*async\b|async\s+calculateMetadata\b|calculateMetadata\s*:\s*async"
            )
        ),
        "calculateMetadata returns a Promise — HF needs composition metadata up front",
        "Resolve metadata at build time and pass concrete values, or use runtime interop",
    ),
    Rule(
        "r2hf/third-party-react-ui",
        BLOCKER,
        _third_party_react_ui,
        "Imports a third-party React UI library — no HF equivalent",
        "Use runtime interop, or rewrite the affected components as HTML+CSS",
    ),
    # Lambda is a warning, not a blocker: it's deployment config, orthogonal
    # to the rendered composition. The skill drops the import and translates
    # the rest. See references/escape-hatch.md.
    Rule(
        "r2hf/lambda-import",
        WARNING,
        _regex_matcher(re.compile(r"from\s+['\"]@remotion/lambda['\"]")),
        "@remotion/lambda is Remotion-specific distributed rendering — no HF equivalent today",
        "Drop the Lambda config; HF runs single-machine. Document the gap in TRANSLATION_NOTES.md.",
    ),
    Rule(
        "r2hf/delay-render",
        WARNING,
        _regex_matcher(re.compile(r"\bdelayRender\s*\(")),
        "delayRender() — HF waits on asset readiness via the Frame Adapter pattern",
        "Drop the call; HF handles this transparently",
    ),
    Rule(
        "r2hf/use-callback",
        WARNING,
        _regex_matcher(re.compile(r"\buseCallback\s*\(")),
        "useCallback — typically decorative for render performance, no HF equivalent needed",
        "Drop the wrapper, inline the function",
    ),
    Rule(
        "r2hf/use-memo",
        WARNING,
        _regex_matcher(re.compile(r"\buseMemo\s*\(")),
        "useMemo — typically decorative, no HF equivalent needed",
        "Drop the wrapper, compute inline",
    ),
    Rule(
        "r2hf/custom-hook",
        WARNING,
        _custom_hook,
        "Custom hook defined locally — may need manual rewrite",
        "Inline the hook body if pure; bow out to runtime interop if it uses useState/useEffect",
    ),
    Rule(
        "r2hf/static-file",
        INFO,
        _regex_matcher(re.compile(r"\bstaticFile\s*\(")),
        "staticFile() reference — convert to a relative path in the HF composition",
        "Replace `staticFile(\"x.png\")` with `\"x.png\"` and copy the asset alongside the HTML",
    ),
    Rule(
        "r2hf/interpolate-colors",
        INFO,
        _regex_matcher(re.compile(r"\binterpolateColors\s*\(")),
        "interpolateColors() — translate to a GSAP color tween",
        "See references/timing.md for the GSAP equivalent",
    ),
]


def _find_matching_paren(src: str, open_idx: int) -> int | None:
    """Given the index of an open `(`, return the index of its matching `)`.

    Skips parens that appear inside `'...'`, `"..."`, or `` `...` `` string
    literals. Returns None if no matching close paren is found.

    This is good enough for hand-written Remotion source. It does not handle
    template-literal interpolations `${...}` recursively or comments — both
    are uncommon in Remotion code we expect to lint and would only matter
    if the unbalanced paren landed inside such a region.
    """
    if open_idx >= len(src) or src[open_idx] != "(":
        return None
    depth = 0
    i = open_idx
    in_str: str | None = None
    while i < len(src):
        c = src[i]
        if in_str is not None:
            if c == "\\":
                i += 2
                continue
            if c == in_str:
                in_str = None
            i += 1
            continue
        if c in ("'", '"', "`"):
            in_str = c
            i += 1
            continue
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return None


def lint_file(path: Path) -> list[Finding]:
    # Remotion sources are UTF-8. Left to the platform default, a source carrying an
    # em dash or a curly quote raises UnicodeDecodeError on Windows before any rule runs.
    src = path.read_text(encoding="utf-8")
    findings: list[Finding] = []

    def loc(offset: int) -> tuple[int, int]:
        line = src.count("\n", 0, offset) + 1
        col = offset - (src.rfind("\n", 0, offset) + 1) + 1
        return line, col

    for rule in RULES:
        for offset, override_message in rule.matcher(src):
            line, col = loc(offset)
            findings.append(
                Finding(
                    str(path),
                    line,
                    col,
                    rule.severity,
                    rule.rule_id,
                    override_message or rule.message,
                    rule.recommendation,
                )
            )

    findings.sort(key=lambda f: (f.file, f.line, f.column))
    return findings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("path", type=Path, help="Directory or file to lint")
    ap.add_argument("--json", action="store_true", help="Emit JSON instead of human-readable output")
    args = ap.parse_args()

    if not args.path.exists():
        print(f"error: {args.path} does not exist", file=sys.stderr)
        return 2

    files: list[Path]
    if args.path.is_file():
        files = [args.path]
    else:
        files = sorted(
            p
            for p in args.path.rglob("*")
            if p.is_file()
            and p.suffix in {".ts", ".tsx", ".jsx", ".js"}
            and "node_modules" not in p.parts
        )

    all_findings: list[Finding] = []
    for f in files:
        all_findings.extend(lint_file(f))

    blockers = sum(1 for f in all_findings if f.severity == BLOCKER)
    warnings = sum(1 for f in all_findings if f.severity == WARNING)
    infos = sum(1 for f in all_findings if f.severity == INFO)

    if args.json:
        json.dump(
            {
                "files_scanned": len(files),
                "blockers": blockers,
                "warnings": warnings,
                "infos": infos,
                "findings": [asdict(f) for f in all_findings],
            },
            sys.stdout,
            indent=2,
        )
        sys.stdout.write("\n")
    else:
        for f in all_findings:
            print(f"{f.file}:{f.line}:{f.column} [{f.severity}] {f.rule}: {f.message}")
            print(f"    -> {f.recommendation}")
        print()
        print(f"{len(files)} files scanned · {blockers} blocker · {warnings} warning · {infos} info")
        if blockers:
            print("RECOMMENDATION: do not attempt translation. Use the runtime interop pattern from PR #214.")

    return 1 if blockers else 0


if __name__ == "__main__":
    sys.exit(main())
