-- Call logs: per-lead call history
CREATE TABLE public.call_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'no_answer',
  direction TEXT NOT NULL DEFAULT 'outbound',
  duration_seconds INTEGER,
  notes TEXT,
  next_action_at TIMESTAMP WITH TIME ZONE,
  source TEXT NOT NULL DEFAULT 'manual',
  vapi_call_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT call_logs_outcome_check CHECK (outcome IN (
    'no_answer','voicemail','interested','not_qualified',
    'scheduled_viewing','callback_requested','wrong_number','other'
  )),
  CONSTRAINT call_logs_direction_check CHECK (direction IN ('outbound','inbound')),
  CONSTRAINT call_logs_source_check CHECK (source IN ('manual','vapi'))
);

CREATE INDEX idx_call_logs_lead_created ON public.call_logs (lead_id, created_at DESC);
CREATE INDEX idx_call_logs_user_created ON public.call_logs (user_id, created_at DESC);

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own call logs"
  ON public.call_logs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own call logs"
  ON public.call_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own call logs"
  ON public.call_logs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own call logs"
  ON public.call_logs FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER call_logs_touch_updated_at
  BEFORE UPDATE ON public.call_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();