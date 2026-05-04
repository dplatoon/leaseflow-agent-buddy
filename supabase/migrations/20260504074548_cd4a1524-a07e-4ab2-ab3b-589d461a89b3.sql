
-- Speed up "have we seen this delivery before?" lookups and prevent duplicate
-- audit rows for the same request id (used as the idempotency key).
CREATE UNIQUE INDEX IF NOT EXISTS webhook_logs_request_id_success_uniq
  ON public.webhook_logs (request_id)
  WHERE status = 'inserted';

CREATE INDEX IF NOT EXISTS webhook_logs_request_id_idx
  ON public.webhook_logs (request_id);

-- Prevent duplicate transcript rows from Vapi retries. A session/role/text
-- triple is effectively unique within a single call.
CREATE UNIQUE INDEX IF NOT EXISTS call_transcripts_session_role_text_uniq
  ON public.call_transcripts (session_id, role, md5(text));

-- Helpful index for the per-IP rate-limiter sliding window scan.
CREATE INDEX IF NOT EXISTS webhook_ip_attempts_ip_created_at_idx
  ON public.webhook_ip_attempts (ip, created_at DESC);
