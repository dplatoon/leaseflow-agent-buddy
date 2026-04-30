-- Webhook attempt log for debugging Vapi (and future) webhooks
CREATE TABLE public.webhook_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID NOT NULL,
  source TEXT NOT NULL DEFAULT 'vapi',
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  agent_id TEXT,
  user_id UUID,
  lead_id UUID,
  ip TEXT,
  user_agent TEXT,
  duration_ms INTEGER,
  error_message TEXT,
  payload_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_logs_created_at ON public.webhook_logs (created_at DESC);
CREATE INDEX idx_webhook_logs_request_id ON public.webhook_logs (request_id);
CREATE INDEX idx_webhook_logs_user_id ON public.webhook_logs (user_id);
CREATE INDEX idx_webhook_logs_agent_id ON public.webhook_logs (agent_id);
CREATE INDEX idx_webhook_logs_status ON public.webhook_logs (status);

ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

-- Authenticated users can view only their own webhook log rows.
-- Service role (used by the server route) bypasses RLS automatically.
CREATE POLICY "Users view own webhook logs"
ON public.webhook_logs
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
