import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { Lead } from "@/lib/leaseflow";

function playBeep() {
  try {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.22);
    setTimeout(() => ctx.close().catch(() => {}), 400);
  } catch { /* ignore */ }
}

export function useNewLeadRealtime(onNewLead?: (lead: Lead) => void) {
  const { user } = useAuth();
  const cbRef = useRef(onNewLead);
  useEffect(() => { cbRef.current = onNewLead; }, [onNewLead]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`leads-realtime-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "leads", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const lead = payload.new as Lead;
          toast.success(`New lead captured: ${lead.full_name} — ${lead.phone ?? "no phone"}`);
          playBeep();
          cbRef.current?.(lead);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);
}