# Pulse Dashboard End-to-End Workflow (Current State)

This document describes how the current system works from survey submission to dashboard visibility and Slack leadership notifications.

## 1) Data Collection

1. Team members submit pulse responses via Google Form.
2. Responses are stored in the Google Sheet form response tab.

## 2) Fast Submission Trigger (Lightweight)

1. `onFormSubmitLight` runs immediately after each form submission.
2. It stamps the current cycle on the submitted row.
3. It sets a pipeline dirty flag in Script Properties.
4. It does not run heavy processing, AI generation, or Slack posting.

Purpose:
- Keep submission processing quick and reliable.
- Avoid slow trigger failures during form capture.

## 3) Scheduled Pipeline Trigger

1. A time-based trigger executes `runTimedPipeline_` (configured interval).
2. If dirty flag is FALSE, it exits with no processing.
3. If dirty flag is TRUE, it runs `runFullPipeline`.
4. A document lock prevents concurrent overlapping runs.

## 4) Full Pipeline Execution

`runFullPipeline` performs the core workflow in sequence:

1. Validate required inputs and configuration.
2. Generate leadership summary from latest pulse data.
3. Update trend/history data.
4. Update role split data when helper is available.
5. Generate or refresh AI insights.
6. Evaluate Slack send conditions and post if all guards pass.

## 5) Slack Leadership Posting (Guarded)

`sendLeadershipSummaryToSlack` posts only when all checks pass:

1. Send approval flag is enabled in Settings.
2. Response count meets minimum threshold.
3. Current cycle has not already been posted.
4. Payload hash differs from the last posted hash.

After successful post:

1. Save last hash and send timestamp.
2. Mark cycle as posted to prevent duplicate cycle sends.
3. Reset approval flag.

## 6) Dashboard Read Path (Web App)

1. Next.js server fetches Apps Script endpoint with shared secret.
2. Apps Script `doGet` returns consolidated dashboard JSON.
3. Dashboard renders:
   - summary metrics
   - area scores
   - trends
   - role split
   - response counts/mix
   - comments
   - actions

## 7) AI Insights On Demand

1. UI requests AI insight generation through `/api/gemini-insights`.
2. Route builds prompt from structured pulse data and comments.
3. Gemini returns summary and rows.
4. Result is persisted back to Apps Script AI Insights storage by cycle.
5. Subsequent loads can reuse persisted insights.

## 8) Action Tracker Write Path

1. UI calls `/api/actions` for create/update/delete.
2. API route validates/sanitizes payload and enforces same-origin write checks.
3. Route forwards to Apps Script with shared secret.
4. Apps Script writes to Action Tracker sheet (soft delete via status).

## 9) Access Control Model

1. Apps Script web app is externally reachable at deployment level.
2. Effective access is controlled by shared-secret checks in `doGet` and `doPost`.
3. Dashboard server passes secret for all read/write flows.
4. Unauthorized requests return JSON unauthorized response.

## 10) End-to-End Flow Summary

1. Form submit -> cycle stamp + dirty flag.
2. Scheduled run -> validate -> summary/trend/role split -> AI -> Slack guard/post.
3. Dashboard load -> read consolidated JSON -> render.
4. On-demand AI -> generate -> persist -> reuse.
5. Actions -> validated write -> sheet persistence.
