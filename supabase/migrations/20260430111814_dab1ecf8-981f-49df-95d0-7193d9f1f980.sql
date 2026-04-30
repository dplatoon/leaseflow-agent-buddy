CREATE TABLE public.webhook_ip_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ip text NOT NULL,
  agent_id text,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_ip_attempts_ip_time
  ON public.webhook_ip_attempts (ip, created_at DESC);

ALTER TABLE public.webhook_ip_attempts ENABLE ROW LEVEL SECURITY;

-- Intentionally no policies: only the service role (server) can read/write.

CREATE OR REPLACE FUNCTION public.prune_webhook_ip_attempts()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.webhook_ip_attempts
  WHERE created_at < now() - interval '1 day';
$$;