
-- Reminders table
CREATE TABLE public.lead_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL,
  kind text NOT NULL DEFAULT 'call',
  note text,
  status text NOT NULL DEFAULT 'pending',
  auto_created boolean NOT NULL DEFAULT false,
  triggered_by_status text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_reminders_user_due ON public.lead_reminders(user_id, status, due_at);
CREATE INDEX idx_lead_reminders_lead ON public.lead_reminders(lead_id);

ALTER TABLE public.lead_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own reminders" ON public.lead_reminders
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own reminders" ON public.lead_reminders
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own reminders" ON public.lead_reminders
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own reminders" ON public.lead_reminders
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Reminder rules: one row per user, per-status default offset hours
CREATE TABLE public.reminder_rules (
  user_id uuid PRIMARY KEY,
  new_hours integer,
  contacted_hours integer,
  scheduled_hours integer,
  closed_hours integer,
  lost_hours integer,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reminder_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own reminder rules" ON public.reminder_rules
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own reminder rules" ON public.reminder_rules
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own reminder rules" ON public.reminder_rules
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER reminder_rules_touch
  BEFORE UPDATE ON public.reminder_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed default rules when a new profile is created
CREATE OR REPLACE FUNCTION public.seed_default_reminder_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.reminder_rules (user_id, new_hours, contacted_hours, scheduled_hours, closed_hours, lost_hours)
  VALUES (NEW.id, 24, 48, 24, NULL, NULL)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_seed_reminder_rules
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.seed_default_reminder_rules();

-- Backfill rules for existing profiles
INSERT INTO public.reminder_rules (user_id, new_hours, contacted_hours, scheduled_hours, closed_hours, lost_hours)
SELECT id, 24, 48, 24, NULL, NULL FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;
