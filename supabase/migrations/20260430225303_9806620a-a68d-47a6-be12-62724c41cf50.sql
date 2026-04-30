ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS call_logs_outcome_check;
ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_outcome_check CHECK (outcome IN (
  'no_answer','voicemail','interested','not_qualified','scheduled_viewing',
  'callback_requested','wrong_number','other','message_sent','message_failed'
));