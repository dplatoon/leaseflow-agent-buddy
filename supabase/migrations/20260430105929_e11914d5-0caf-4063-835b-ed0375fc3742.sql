-- Multi-agent support: each user can have many agents, each with its own webhook secret.
CREATE TABLE public.agents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  agent_id TEXT NOT NULL UNIQUE DEFAULT ('agent_' || replace(gen_random_uuid()::text, '-', '')),
  webhook_secret TEXT NOT NULL DEFAULT ('whsec_' || encode(extensions.gen_random_bytes(32), 'hex')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agents_user_id ON public.agents(user_id);
CREATE INDEX idx_agents_agent_id ON public.agents(agent_id);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own agents" ON public.agents
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own agents" ON public.agents
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own agents" ON public.agents
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users delete own agents" ON public.agents
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER agents_touch_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Backfill: create a default agent row for every existing profile so legacy
-- integrations (using the profile's agent_id + webhook_secret) keep working.
INSERT INTO public.agents (user_id, name, agent_id, webhook_secret)
SELECT id, 'Default assistant', agent_id, webhook_secret
FROM public.profiles
ON CONFLICT (agent_id) DO NOTHING;