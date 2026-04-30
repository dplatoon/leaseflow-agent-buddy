CREATE TABLE public.email_resend_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  email text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.email_resend_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own resend attempts"
  ON public.email_resend_attempts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_email_resend_attempts_user_created
  ON public.email_resend_attempts (user_id, created_at DESC);