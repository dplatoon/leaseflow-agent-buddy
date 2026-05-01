
# Final Audit — Messaging, Failures, Retry, Export

## What is already in place (verified)

Templates & sending
- `src/lib/templates.ts` — variable rendering (`{{name}}`, `{{first_name}}`, `{{location}}`, …), phone normalization, `wa.me` and `sms:` link builders, `logMessageAttempt` (sent / failed) writing structured headers into `call_logs.notes`.
- `MessageTemplatesSection.tsx` + `SendMessageDialog.tsx` — manage templates, send 1‑off messages, log result.
- DB: `message_templates` and `call_logs` tables exist with proper RLS (user-scoped CRUD).

Failure tracking
- `call_logs.outcome` includes `message_sent` and `message_failed`.
- `parseFailureReason` + `parseChannelFromNote` extract channel + reason from the note header.
- `LeadDetailSheet` shows a “Last message failed” banner with one-click Resend.
- `LeadCallsSection` has outcome filter (incl. Failures) and group-by-reason mode.

Bulk workflows
- `RetryFailedMessagesDialog.tsx` — scans selected leads for latest `message_failed`, re-renders body with current lead vars, opens deep links staggered 400ms, shows progress + per-lead Sent/Failed badges, re-logs every attempt.
- `ExportFailuresButton.tsx` — date-range CSV (presets + calendar), scoped to current Leads filter or all-time on Dashboard, includes parsed channel + reason + lead context.

Dashboard
- “Messages Today” / “This Week” KPIs (sent vs failed + success %).
- 7-day delivery breakdown with top failure reasons.
- Global Export Failures button.

## Gaps and risks found in audit

1. Popup-block heuristic is unreliable
   - `window.open` returning a window object does not guarantee the user actually saw WhatsApp open; some popup blockers return a stub. We may log `sent` when nothing happened.

2. Retry flow uses original *rendered* body
   - Stored `body` is post-render text from the original failure. `renderTemplate(c.body, …)` is a no-op on it, so updated lead fields (e.g. fixed phone, new budget) aren’t reflected. The phone is re-read live (good), but the message text isn’t.

3. No dedupe / cooldown on retry
   - If a lead already has a `message_sent` *after* the latest `message_failed`, the retry dialog still queues it. Could double-message a lead.

4. CSV export hits the 1000-row Supabase default
   - Long history + “All time” will silently truncate. Needs paging or an explicit cap warning.

5. No realtime refresh after retry
   - `LeadCallsSection` listens to `leaseflow:calls-changed`, but the Dashboard KPIs don’t — they require a manual reload to reflect a just-finished retry batch.

6. SMS deep-link URL shape
   - We use `sms:<num>?&body=…`. The leading `?&` is non-standard; Android prefers `?body=`, iOS accepts `&body=` only after a `?`. Should be `sms:<num>?body=…` (works on both).

7. No rate limiter / batch cap
   - User can select 200 leads and trigger 200 `window.open` calls. Browsers will block almost all. Needs a soft cap (e.g. 25/batch) with a “Continue with next batch” affordance.

8. Accessibility / mobile
   - Retry dialog progress list is fine, but there is no keyboard shortcut to cancel between sends and no way to skip a single lead mid-run.

## Recommended end-steps (ship order)

Step 1 — Correctness fixes (small, high value)
- Fix SMS link to `sms:<num>?body=…` in `buildSmsLink`.
- In `RetryFailedMessagesDialog`, skip leads whose latest `call_logs` row is `message_sent` newer than the latest `message_failed` (dedupe).
- In retry, store the *template name* + look up live template body when available; fall back to stored body. Always re-run `renderTemplate` against the live `Lead`.

Step 2 — Robustness
- Cap retry batch at 25; if more candidates exist, show “Run next 25” button after the current batch completes.
- Improve popup detection: if `w` is null **or** `w.closed` is true within 50 ms, mark as failed.
- Page CSV export in chunks of 1000 until exhausted; show row count in toast.

Step 3 — UX polish
- Add a “Skip” button on each row during `running` to bail out of the next `window.open` for that lead.
- Dashboard: subscribe to `leaseflow:calls-changed` and refetch the 7‑day window so KPIs update live after retry.
- Leads page: add a small badge on the row when a lead has an unresolved failure (latest message log = failed).

Step 4 — Optional, nice to have
- Saved CSV export presets per user (e.g. “last 30d, WhatsApp only”).
- “Mark failure as resolved” action that writes a tiny `message_sent` placeholder log so the banner / badge clears without forcing a new send.
- Per-failure-reason quick filter chips on Dashboard breakdown that deep-link into Leads filtered by leads with that failure reason.

## Technical notes (for implementation phase)

- Dedupe query (per lead): take the single latest `call_logs` row where `outcome IN ('message_sent','message_failed')` and only retry if it is `message_failed`. This is one query with `order created_at desc` + `limit 1` per lead, or a single grouped query using `distinct on (lead_id)` via an RPC. Simpler client-side: fetch last N logs per selected lead and compare in JS.
- Live template lookup: pass `templates: MessageTemplate[]` into `RetryFailedMessagesDialog` (already loaded on Leads page if needed) and match by `templateName`. If no match, keep stored body.
- Batch cap: keep candidate list intact, but slice into windows of 25 and drive `runRetry` over the current window only.
- Popup detection:
  ```ts
  const w = window.open(link, "_blank", "noopener,noreferrer");
  await new Promise((r) => setTimeout(r, 50));
  const blocked = !w || w.closed === true;
  ```
- Dashboard live refresh: `useEffect(() => { const h = () => loadCalls(); window.addEventListener("leaseflow:calls-changed", h); return () => window.removeEventListener(...); }, [])`.

No DB migrations are required for any of these steps — all changes are in `src/lib/templates.ts`, the retry dialog, the export button, and the dashboard.
