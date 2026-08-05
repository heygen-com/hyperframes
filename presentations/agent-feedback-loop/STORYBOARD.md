---
workflow: slideshow
mode: autonomous
message: "Put the HyperFrames feedback command inside the agent's existing verification loop, and every render becomes a structured learning opportunity."
audience: "HeyGen engineering, product, and developer-experience teams"
aspect: 1920x1080
language: en
slides: 12
---

# Story spine

Rhythm: **claim — blind spot — familiar loop — leverage point — instrumented loop — packet anatomy — rollout — evidence — interpretation — operating model — next decision — command**.

The emotional move is from a silent green pipeline to a visible learning system. The deck stays technical and source-backed, but each slide carries one complete claim rather than a dashboard of facts.

## 1. Every verified render can teach us something

- **Claim:** The fastest way to learn from AI-generated video is to instrument the loop agents already obey.
- **Visual world:** A dark HyperFrames canvas with the brand mark acting as a hinge between “render” and “learn”; one bright signal travels through a quiet grid.
- **Presenter beat:** Establish that this is not a new survey workflow. It is one command placed at the highest-context moment.

## 2. Green pipelines can still produce bad experiences

- **Claim:** Exit code 0 proves execution, not satisfaction.
- **Visual world:** A large green “PASS” panel on the left; on the right, three failure modes that tests cannot see—wrong look, confusing workflow, slow workaround.
- **Presenter beat:** Distinguish system correctness from user-perceived success.

## 3. Agents already follow a disciplined verification loop

- **Claim:** The existing workflow already has the right checkpoint for feedback.
- **Visual world:** Mermaid-style flow: AUTHOR → LINT + CHECK → INSPECT FRAMES → USER APPROVAL → RENDER. The line is clean and linear.
- **Presenter beat:** Explain why the insertion point belongs after verification, not at task start or after context is lost.

## 4. The leverage point is one command after verified output

- **Claim:** Add `hyperframes feedback` where evidence and context are still warm.
- **Visual world:** The command occupies the center like a new node being snapped into an existing cable. The old line stays visible behind it.
- **Presenter beat:** Show the 0–10 rating and concise clean-run path; problem reports carry a structured packet.

## 5. The loop now closes on maintainers

- **Claim:** A render can become a reproducible product signal without interrupting the user.
- **Visual world:** Mermaid-style closed loop: AGENT LOOP → FEEDBACK COMMAND → ANONYMOUS EVENT + BACKEND FORWARD → MAINTAINER TRIAGE → CLI / SKILL FIX → NEXT AGENT RUN.
- **Presenter beat:** Clarify that public issue creation is separately consented; normal feedback remains anonymous and best-effort.

## 6. Structure turns a complaint into a debuggable packet

- **Claim:** Actionability comes from the packet, not the prose volume.
- **Visual world:** A terminal-shaped packet with six labeled fields, paired with a privacy shield listing what never leaves the machine.
- **Presenter beat:** Repro command, expected/actual, exact error, completion/fallback status, workaround, repro status; visual defects add a privacy-safe composition census.

## 7. The mechanism matured in four deliberate steps

- **Claim:** The feedback loop was not one feature launch; it became useful through successive contract improvements.
- **Visual world:** Four horizontal milestones: May 28 collection; June 29/30 agent-loop mandate; July 15–17 actionable repro + census; July 27/28 queryable product event.
- **Presenter beat:** Name v0.7.21 as the behavioral intervention and v0.7.77 as the schema boundary. Metrics must union both schemas.

## 8. PostHog shows sustained reporting at production scale

- **Claim:** We should measure submissions and participating installs, not celebrate instrumentation alone.
- **Visual world:** Three large metric wells: 1,910 feedback submissions per complete day, 13,370 in the latest complete week, and 4,783 participating anonymous installs.
- **Presenter beat:** State that the values are the authenticated aggregate-only union for July 29–August 4 PDT; 96.5% include a detected agent runtime.

## 9. After the agent mandate, feedback reached 4.03 submissions per 100 renders

- **Claim:** Equal-window exposure-normalized reporting moved from effectively zero to a measurable operating signal.
- **Visual world:** Before/after bars for submissions per 100 captured `render_complete` events and participating installs per 100 active render installs, with numerator and denominator counts beneath.
- **Presenter beat:** Use equal 14-day windows in PDT, exclude rollout day, and describe the association rather than calling it causal because CLI adoption is staggered.

## 10. The winning design combines tooling and agent policy

- **Claim:** The CLI makes feedback possible; the skill makes it habitual.
- **Visual world:** Two interlocking halves: PRODUCT SURFACE (command, transport, join keys) and AGENT CONTRACT (verify, inspect, report once per task, protect privacy).
- **Presenter beat:** Explain why either half alone underperforms: a command nobody calls is latent, and a prompt without a reliable command is friction.

## 11. The next decision is an adoption experiment, not another feature

- **Claim:** Ship the loop broadly, then gate expansion on observed journeys.
- **Visual world:** Three-step operating plan: release → observe → improve; explicit guardrail that feedback text stays private and second-order automation waits for data.
- **Presenter beat:** Recommend a stable query/dashboard and weekly review cadence before adding more collection surfaces.

## 12. Make every render close the loop

- **Claim:** Verify. Report. Improve.
- **Visual world:** The exact command on a nearly empty brand frame with the HyperFrames mark and a single cyan-to-green signal line.
- **Presenter beat:** Close with the behavior we want agents to repeat and the decision we need from the team.
