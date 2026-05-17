# Story Patterns

Five narrative templates that map a PR type to a scene sequence. The skill detects the PR type in Phase 3.1 and loads the matching pattern file.

## Detection Signals

| Signal                                                                                    | Pattern               |
| ----------------------------------------------------------------------------------------- | --------------------- |
| Public API / types / exports change                                                       | `api-library-feature` |
| UI component files (`*.tsx` under `components/` or `ui/`), Storybook stories, CSS changes | `ui-feature`          |
| Perf keywords in title (ms, throughput, speedup, faster, x%); benchmark files             | `performance-win`     |
| "fix" in title, `bug` label, links to bug issues                                          | `bug-fix`             |
| None of the above                                                                         | `generic-fallback`    |

## Pattern Shape

Each pattern file documents: **When to use**, **Scene sequence**, **Code handling**, **Hook pattern bias**.

## Overrides

The user can override pattern detection in Phase 3.1. The detected pattern is a default, not a commitment.
