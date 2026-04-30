-- Add per-user webhook secret to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS webhook_secret text NOT NULL
    DEFAULT ('whsec_' || encode(gen_random_bytes(32), 'hex'));

-- Ensure secrets are unique across users
CREATE UNIQUE INDEX IF NOT EXISTS profiles_webhook_secret_key
  ON public.profiles (webhook_secret);