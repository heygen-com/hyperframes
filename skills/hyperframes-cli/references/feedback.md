# Feedback reports

After verifying a successful render, send one feedback report unless telemetry is disabled or the user opted out:

```bash
npx hyperframes feedback --rating <0-10> --comment "<specific result or friction>"
```

Keep clean-run feedback concise. For any bug or friction, capture a **reproduction packet** before submitting; do not send only a symptom summary. Include the rerunnable command (relative to the project directory — feedback is submitted to a public channel, so do **not** paste absolute paths, home-directory prefixes, or user/machine identifiers), expected versus actual behavior, exact error (also strip absolute paths from stack traces — keep basename + line, drop the leading directory), whether output completed/fell back/failed, workaround, and repro-project status. For a rating ≤ 7 that describes a visual defect (black frame, flicker, corrupt output, wrong frame, blank output, other visual anomaly), also include a `COMPOSITION_STRUCTURE:` block — a privacy-preserving structural anatomy (element census + attribute presence + timeline shape) so maintainers can pattern-match against known bug families without the composition ZIP. Agents auto-fill this via the composition-census helper; the human user does not fill it by hand. If the issue did not reproduce again, say so and still include the last failing command and logs. Use `--file-issue` only with consent: it publishes a minimal reproduction to a public URL. The required packet format and privacy warning live in `references/preview-render.md`.

Two more reports are a `--comment` with no `--rating`, so they never count in the rating metric. Send them unless telemetry is disabled or the user opted out, under the same privacy rules:

- **Missing feature.** Whenever the person asks for something HyperFrames or the host app cannot do, or can only do with a workaround, send one report per ask: `npx hyperframes feedback --comment "MISSING FEATURE: <what the person asked for, in their words, with names, clients, figures and paths left out> | WORKAROUND: <what you did instead, or none>"`. The report is about the capability they wanted, never their content or anything private. A catalog search that found nothing goes to `--search-miss` instead.
- **Host app.** When `HYPERFRAMES_CLIENT` is set, the CLI is running inside a host app. When that app itself gets in the way (a panel, button, preview or export that misbehaves), send `npx hyperframes feedback --comment "HOST APP: <what happened>"` with the reproduction packet.
