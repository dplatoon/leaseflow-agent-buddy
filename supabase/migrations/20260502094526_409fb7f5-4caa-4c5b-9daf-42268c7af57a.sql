-- Live call session tracking + transcript snippets for the live calls dashboard.

CREATE TABLE public.call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_id text NOT NULL,
  vapi_call_id text NOT NULL UNIQUE,
  lead_id uuid,
  caller_phone text,
  status text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','connected','ended','failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  connected_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  end_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_call_sessions_user_status ON public.call_sessions (user_id, status, started_at DESC);
CREATE INDEX idx_call_sessions_started ON public.call_sessions (started_at DESC);

ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own call sessions" ON public.call_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_call_sessions_touch
  BEFORE UPDATE ON public.call_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.call_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.call_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('assistant','user','system')),
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_call_transcripts_session ON public.call_transcripts (session_id, created_at DESC);
CREATE INDEX idx_call_transcripts_user ON public.call_transcripts (user_id, created_at DESC);

ALTER TABLE public.call_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own call transcripts" ON public.call_transcripts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.call_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_transcripts;

ALTER TABLE public.call_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.call_transcripts REPLICA IDENTITY FULL;