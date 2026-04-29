Ship the current branch safely.

1. Read git status and current branch. Stop if on main/master.
2. Summarize changed files and intent from diff.
3. Run project gates: typecheck, build, tests, lint/format where available.
4. Invoke staff-code-reviewer and security-auditor on the diff.
5. Fix MUST/CRITICAL/HIGH items only after explaining them.
6. Ensure PR exists or create one with summary, tests, risks, and linked issues.
7. Final output: branch, PR URL, commits, gate results, unresolved risks.
