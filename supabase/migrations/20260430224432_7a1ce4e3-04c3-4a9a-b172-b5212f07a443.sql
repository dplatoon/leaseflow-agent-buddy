CREATE TABLE public.message_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT message_templates_channel_check CHECK (channel IN ('whatsapp','sms'))
);

CREATE INDEX idx_message_templates_user ON public.message_templates (user_id, created_at DESC);

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own templates"
  ON public.message_templates FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own templates"
  ON public.message_templates FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own templates"
  ON public.message_templates FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own templates"
  ON public.message_templates FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER message_templates_touch_updated_at
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- Allow logging messages in call_logs by extending the outcome check
ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS call_logs_outcome_check;
ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_outcome_check CHECK (outcome IN (
  'no_answer','voicemail','interested','not_qualified',
  'scheduled_viewing','callback_requested','wrong_number','other','message_sent'
));