import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const TRIAL_DAYS = 7;

export type SubState = {
  loading: boolean;
  isSubscribed: boolean;
  trialDaysLeft: number;
  trialExpired: boolean;
  hasAccess: boolean;
};

export function useSubscription(): SubState {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [createdAt, setCreatedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("is_subscribed, created_at")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setIsSubscribed(!!data?.is_subscribed);
      setCreatedAt(data?.created_at ? new Date(data.created_at) : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const now = Date.now();
  const start = createdAt?.getTime() ?? now;
  const elapsedDays = (now - start) / (1000 * 60 * 60 * 24);
  const trialDaysLeft = Math.max(0, Math.ceil(TRIAL_DAYS - elapsedDays));
  const trialExpired = elapsedDays >= TRIAL_DAYS;
  const hasAccess = isSubscribed || !trialExpired;

  return { loading, isSubscribed, trialDaysLeft, trialExpired, hasAccess };
}