import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { completeReminder, snoozeReminder, type Reminder } from "@/lib/reminders";

const POLL_MS = 30_000;
// Don't re-toast the same reminder for this long (covers snoozes/page reloads)
const SUPPRESS_MS = 60 * 60 * 1000;
const STORAGE_KEY = "leaseflow:notified-reminders";

type NotifiedMap = Record<string, number>;

function loadNotified(): NotifiedMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as NotifiedMap;
    const now = Date.now();
    // Garbage-collect stale entries
    return Object.fromEntries(
      Object.entries(parsed).filter(([, t]) => now - t < SUPPRESS_MS),
    );
  } catch {
    return {};
  }
}

function saveNotified(map: NotifiedMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * Polls for due pending reminders and surfaces a toast (with quick actions)
 * the first time each one becomes due in this browser. Runs only when a
 * user is signed in. Mount once near the top of the authed app shell.
 */
export function useDueReminderToasts() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const notifiedRef = useRef<NotifiedMap>(loadNotified());
  // Skip toasts on the very first poll after mount (avoids a flood when the
  // user opens the app to a backlog of already-due reminders).
  const primedRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const persist = () => saveNotified(notifiedRef.current);

    const fetchLeadName = async (leadId: string): Promise<string | null> => {
      const { data } = await supabase
        .from("leads")
        .select("full_name, phone")
        .eq("id", leadId)
        .maybeSingle();
      if (!data) return null;
      return data.full_name || data.phone || null;
    };

    const showToast = async (r: Reminder) => {
      const leadName = await fetchLeadName(r.lead_id);
      const title = `${r.kind === "call" ? "Call" : r.kind === "message" ? "Message" : "Follow up"}${leadName ? `: ${leadName}` : ""}`;
      toast(title, {
        id: `reminder-${r.id}`,
        description: r.note || (r.triggered_by_status ? `Status: ${r.triggered_by_status}` : "Reminder due now"),
        duration: 15_000,
        action: {
          label: "Open",
          onClick: () => navigate({ to: "/reminders" }),
        },
        cancel: {
          label: "Done",
          onClick: () => {
            void completeReminder(r.id).catch(() => {
              toast.error("Couldn't mark done");
            });
          },
        },
        onAutoClose: () => {
          // After auto-close, expose a quick snooze via a follow-up toast? Keep it simple — no-op.
        },
      });
      // Secondary inline snooze affordance
      // (sonner action+cancel is limited to 2; provide snooze through toast description tap on /reminders.)
      void r;
    };

    const tick = async () => {
      const { data, error } = await supabase
        .from("lead_reminders")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .lte("due_at", new Date().toISOString())
        .order("due_at", { ascending: true })
        .limit(20);
      if (cancelled || error || !data) return;
      const reminders = data as unknown as Reminder[];
      const now = Date.now();

      if (!primedRef.current) {
        // Mark all currently-due reminders as already notified so the user
        // isn't spammed on app open. They're still visible on /reminders.
        for (const r of reminders) notifiedRef.current[r.id] = now;
        primedRef.current = true;
        persist();
        return;
      }

      let changed = false;
      for (const r of reminders) {
        const last = notifiedRef.current[r.id];
        if (last && now - last < SUPPRESS_MS) continue;
        notifiedRef.current[r.id] = now;
        changed = true;
        // Fire and forget (each toast is independent)
        void showToast(r);
      }
      if (changed) persist();
    };

    // Initial prime + interval
    void tick();
    const interval = setInterval(tick, POLL_MS);

    // Re-check immediately when reminders change elsewhere in the app
    const onChanged = () => { void tick(); };
    window.addEventListener("leaseflow:reminders-changed", onChanged);

    // Re-check when the tab becomes visible again
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("leaseflow:reminders-changed", onChanged);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, navigate]);
}

// Re-export for convenience in case other modules want it
export { snoozeReminder };