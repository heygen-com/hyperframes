# PostHog evidence contract

Project: `356858`  
Host: `https://us.posthog.com`  
Timezone: `America/Los_Angeles`  
Queried: 2026-08-05  
Access: authenticated PostHog CLI, aggregate-only

## Privacy and interpretation

- The feedback union is `cli_render_feedback` plus legacy `survey sent` where `$survey_id = render_satisfaction`.
- Results contain only aggregate counts and rates. No feedback text, identifiers, paths, media, account data, or event rows are exported.
- `distinct_id` is a random installation identity, so the deck says “unique anonymous installs,” never users or agents.
- `agent_runtime` is detected runtime metadata. A missing value does not prove a human authored the report.
- The equal-window comparison is descriptive, not causal. CLI and skill adoption are staggered, and rollout day is excluded.
- `render_complete` is the captured successful-render exposure denominator. It is not proof that every render from every installed CLI version was observed.
- PostHog capture is not proof that the best-effort backend/Slack forwarding endpoint accepted the report.

## Verified schema

`read-data-schema` confirmed:

- Events: `survey sent`, `cli_render_feedback`, `render_complete`, `cli_command`, and `cli_command_result`.
- Legacy feedback properties: `$survey_id`, `$survey_response`, `$survey_response_2`, `agent_runtime`, `cli_version`, `feedback_id`, `rating_scale`, and `render_duration_ms`.
- Current feedback properties: `rating`, `rating_scale`, `comment`, `agent_runtime`, `cli_version`, and `feedback_id`.
- `$survey_id` includes `render_satisfaction`.

## Latest seven complete days

Window: 2026-07-29 00:00 through 2026-08-05 00:00 PDT.

```sql
WITH feedback AS (
  SELECT
    toDate(toTimeZone(timestamp, 'America/Los_Angeles')) AS day,
    toString(distinct_id) AS anonymous_install_id,
    toString(properties['agent_runtime']) AS agent_runtime,
    if(
      event = 'cli_render_feedback',
      toString(properties['comment']),
      toString(properties['$survey_response_2'])
    ) AS comment_text
  FROM events
  WHERE timestamp >= toDateTime('2026-07-29 00:00:00', 'America/Los_Angeles')
    AND timestamp < toDateTime('2026-08-05 00:00:00', 'America/Los_Angeles')
    AND (
      event = 'cli_render_feedback'
      OR (
        event = 'survey sent'
        AND toString(properties['$survey_id']) = 'render_satisfaction'
      )
    )
)
SELECT
  day,
  count() AS submissions,
  uniqExact(anonymous_install_id) AS unique_anonymous_installs,
  countIf(notEmpty(agent_runtime)) AS detected_agent_submissions,
  round(100.0 * countIf(notEmpty(agent_runtime)) / count(), 1) AS detected_agent_share_pct,
  countIf(notEmpty(comment_text)) AS comment_bearing_submissions,
  round(100.0 * countIf(notEmpty(comment_text)) / count(), 1) AS comment_rate_pct
FROM feedback
GROUP BY day
ORDER BY day
```

| Day        | Submissions | Unique anonymous installs | Detected agent share | Comment rate |
| ---------- | ----------: | ------------------------: | -------------------: | -----------: |
| 2026-07-29 |       2,269 |                     1,124 |                97.8% |        74.1% |
| 2026-07-30 |       2,206 |                     1,119 |                96.5% |        74.5% |
| 2026-07-31 |       1,682 |                       925 |                97.2% |        76.3% |
| 2026-08-01 |       1,712 |                       896 |                98.5% |        75.5% |
| 2026-08-02 |       1,764 |                       937 |                96.5% |        74.2% |
| 2026-08-03 |       1,865 |                       960 |                93.8% |        74.6% |
| 2026-08-04 |       1,872 |                     1,016 |                95.2% |        75.9% |

Aggregate for the same window:

| Submissions | Per complete day | Unique anonymous installs | Detected agent submissions | Detected agent share |
| ----------: | ---------------: | ------------------------: | -------------------------: | -------------------: |
|      13,370 |          1,910.0 |                     4,783 |                     12,905 |                96.5% |

## Equal-window before/after

Primary behavior intervention: v0.7.21, released 2026-06-29 21:13:40 PDT.  
Pre: June 15–28, 14 complete days.  
Post: June 30–July 13, 14 complete days.  
June 29 is excluded as rollout day.

```sql
WITH labeled AS (
  SELECT
    toTimeZone(timestamp, 'America/Los_Angeles') AS local_ts,
    toString(distinct_id) AS anonymous_install_id,
    event,
    toString(properties['$survey_id']) AS survey_id,
    if(
      toTimeZone(timestamp, 'America/Los_Angeles') >=
        toDateTime('2026-06-15 00:00:00', 'America/Los_Angeles')
      AND toTimeZone(timestamp, 'America/Los_Angeles') <
        toDateTime('2026-06-29 00:00:00', 'America/Los_Angeles'),
      'pre: Jun 15–28',
      if(
        toTimeZone(timestamp, 'America/Los_Angeles') >=
          toDateTime('2026-06-30 00:00:00', 'America/Los_Angeles')
        AND toTimeZone(timestamp, 'America/Los_Angeles') <
          toDateTime('2026-07-14 00:00:00', 'America/Los_Angeles'),
        'post: Jun 30–Jul 13',
        'excluded rollout day'
      )
    ) AS period
  FROM events
  WHERE timestamp >= toDateTime('2026-06-15 00:00:00', 'America/Los_Angeles')
    AND timestamp < toDateTime('2026-07-14 00:00:00', 'America/Los_Angeles')
    AND (
      event = 'render_complete'
      OR event = 'cli_render_feedback'
      OR (
        event = 'survey sent'
        AND toString(properties['$survey_id']) = 'render_satisfaction'
      )
    )
)
SELECT
  period,
  countIf(
    event = 'cli_render_feedback'
    OR (event = 'survey sent' AND survey_id = 'render_satisfaction')
  ) AS feedback_submissions,
  uniqExactIf(
    anonymous_install_id,
    event = 'cli_render_feedback'
    OR (event = 'survey sent' AND survey_id = 'render_satisfaction')
  ) AS participating_installs,
  countIf(event = 'render_complete') AS successful_renders,
  uniqExactIf(anonymous_install_id, event = 'render_complete') AS active_render_installs,
  round(100.0 * feedback_submissions / nullIf(successful_renders, 0), 2)
    AS submissions_per_100_renders,
  round(100.0 * participating_installs / nullIf(active_render_installs, 0), 2)
    AS participating_installs_per_100_active_render_installs
FROM labeled
WHERE period != 'excluded rollout day'
GROUP BY period
ORDER BY period
```

| Period              | Feedback submissions | Participating installs | Captured renders | Active render installs | Submissions / 100 renders | Participating installs / 100 active render installs |
| ------------------- | -------------------: | ---------------------: | ---------------: | ---------------------: | ------------------------: | --------------------------------------------------: |
| Pre: Jun 15–28      |                    4 |                      4 |          195,473 |                 25,350 |                     <0.01 |                                                0.02 |
| Post: Jun 30–Jul 13 |               12,541 |                  4,947 |          311,506 |                 33,832 |                      4.03 |                                               14.62 |

## Query provenance

Executed with official `@posthog/cli` 0.10.0 using `posthog-cli api call --json execute-sql`. The CLI token is stored outside the project in the user's PostHog credential store and is not copied into this deck.
