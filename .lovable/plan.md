# Vapi Setup Wizard + Live Call Dashboard

Two new routes wired into the sidebar, plus a small DB extension to track live call state (ringing → connected → ended) and stream transcript snippets.

---

## 1. New route: `/vapi-setup` — Guided Vapi Setup

A focused, step-by-step page (separate from the busy Settings page) that walks the user through connecting Vapi end-to-end.

**Steps shown as a vertical stepper:**
1. **Choose / confirm assistant** — dropdown of existing agents (from `agents` table) + “create new” inline.
2. **Server URL** — read-only field with the canonical webhook URL (`https://<host>/api/public/vapi-webhook`) and a Copy button.
3. **Webhook secret** — show/hide + copy + regenerate (with the same confirm dialog + countdown already used in Settings).
4. **Vapi Assistant ID** — read-only `agent_id` field with copy. Plus an editable “Vapi-side ID” field stored locally as a sanity hint (no DB change needed; just a `localStorage` reminder so the user can verify they pasted the right one).
5. **Test send** — “Send test webhook” button (reuses existing `sendWebhookTest` server fn) + a “Send with bad secret” button to verify rejection. Live status indicators per check:
   - URL reachable (HTTP status received)
   - Auth accepted (`authOk`)
   - Lead inserted (`insertOk`)
   - Each shows ✅ / ❌ / spinner with the response duration.
6. **Go live checklist** — final summary card with green checks for each prerequisite (active agent, secret present, last test passed within 24 h). “Open live calls” button → `/live-calls`.

**Status indicators:** small `Badge` per row — `idle` (muted), `pending` (spinner), `ok` (green), `fail` (destructive), with the last test timestamp shown.

---

## 2. New route: `/live-calls` — Live Call Dashboard

Real-time view of calls happening *right now*, plus the most recent ended calls.

**Layout (1484px viewport target):**
- Top stat strip: **Active now**, **Ringing**, **Connected**, **Ended (last hour)**.
- Two-column main area:
  - **Active sessions** (left, ~60%): list of cards, one per active call. Each card:
    - Caller phone, agent name, status badge (`ringing` amber pulse / `connected` green / `ended` muted)
    - Duration ticker (live `mm:ss`)
    - Latest transcript snippet (last 1–2 lines, monospace, auto-scroll)
    - “View lead” link if linked
  - **Recent ended** (right): compact table — phone, duration, outcome, time.
- Empty state: friendly “No live calls — make a test call from Vapi” with a link to `/vapi-setup`.

**Realtime:** Supabase Realtime subscription on `call_sessions` and `call_transcripts` (postgres_changes, INSERT + UPDATE). Local duration ticker updates every 1s for cards in `ringing`/`connected`.

---

## 3. Database changes

Two new tables (RLS scoped per user_id, like other tables):

- **`call_sessions`** — one row per Vapi call
  - vapi_call_id (unique), agent_id (text), user_id, lead_id (nullable)
  - caller_phone, status (`ringing` | `connected` | `ended` | `failed`)
  - started_at, connected_at, ended_at, duration_seconds
  - end_reason (text, nullable)
- **`call_transcripts`** — append-only snippets
  - session_id (fk-by-id to call_sessions.id), user_id
  - role (`assistant` | `user` | `system`), text, created_at

Realtime publication: add both tables to `supabase_realtime`.

RLS: `auth.uid() = user_id` for SELECT; INSERT/UPDATE done by service role from the webhook.

---

## 4. Webhook extension

Extend `src/routes/api/public/vapi-webhook.ts` to recognize Vapi event-style payloads (additive — current lead-extraction payload still works):

- If body contains `type: "status-update" | "transcript" | "end-of-call-report"` and a `call.id`, route into `call_sessions` / `call_transcripts` upserts instead of (or in addition to) the lead insert.
- Existing schema stays the default; the new branch is detected before strict parsing.
- Update the Zod schema with a discriminated union so logging and validation continue to work.

(Lead insertion still happens at `end-of-call-report` when extracted fields are present, preserving current behavior.)

---

## 5. Sidebar

Add two nav items in `AppShell.tsx`:
- `Vapi Setup` (PlugZap icon) → `/vapi-setup`
- `Live Calls` (PhoneCall icon) → `/live-calls` with a small live count badge (active sessions) using a 15s poll fallback if Realtime is offline.

---

## Technical notes

- New route files: `src/routes/vapi-setup.tsx`, `src/routes/live-calls.tsx`.
- New helpers: `src/lib/liveCalls.ts` (types + helpers), `src/components/leaseflow/LiveCallCard.tsx`.
- Reuse existing `sendWebhookTest` server fn; no new server fns required for setup wizard.
- For the wizard, persist “last test result” + “last test at” per agent in `localStorage` keyed by `agent_id` (no DB column needed — the readiness check is just UX).
- All new UI uses semantic tokens from `src/styles.css` (no hard-coded colors).
- SEO: each route gets its own `head()` with title + description + og tags.

---

## Order of implementation

1. Create migration: `call_sessions`, `call_transcripts`, RLS, realtime publication.
2. Extend webhook handler to write to those tables on Vapi event payloads.
3. Build `/live-calls` route + realtime subscription.
4. Build `/vapi-setup` route + stepper + status indicators (reusing `sendWebhookTest`).
5. Add sidebar nav entries.
