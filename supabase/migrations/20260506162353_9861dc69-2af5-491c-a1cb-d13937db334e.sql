ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sheets_webhook_url text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS synced_to_sheets boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS leads_user_status_synced_idx ON public.leads (user_id, status, synced_to_sheets, created_at DESC);