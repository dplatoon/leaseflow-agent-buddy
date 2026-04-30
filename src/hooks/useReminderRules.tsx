import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { fetchRules, type ReminderRules, DEFAULT_RULES } from "@/lib/reminders";

/**
 * Loads the current user's reminder rules once and caches them in component state.
 * Returns a stable rules object plus a refresh function.
 */
export function useReminderRules() {
  const { user } = useAuth();
  const [rules, setRules] = useState<ReminderRules | null>(null);

  const refresh = async () => {
    if (!user) return;
    try {
      const r = await fetchRules(user.id);
      setRules(r);
    } catch {
      setRules({ user_id: user.id, ...DEFAULT_RULES });
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return { rules, refresh };
}