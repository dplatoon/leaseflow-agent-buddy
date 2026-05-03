import { supabase } from "@/integrations/supabase/client";

export type CallSessionStatus = "ringing" | "connected" | "ended" | "failed";

export type LeadLinkConfidence = "exact" | "strong" | "partial" | "none";

export type CallSession = {
  id: string;
  user_id: string;
  agent_id: string;
  vapi_call_id: string;
  lead_id: string | null;
  lead_link_confidence: LeadLinkConfidence | null;
  caller_phone: string | null;
  status: CallSessionStatus;
  started_at: string;
  connected_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  end_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type CallTranscript = {
  id: string;
  session_id: string;
  user_id: string;
  role: "assistant" | "user" | "system";
  text: string;
  created_at: string;
};

export async function fetchActiveSessions(): Promise<CallSession[]> {
  const { data, error } = await supabase
    .from("call_sessions" as never)
    .select("*")
    .in("status", ["ringing", "connected"])
    .order("started_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as CallSession[];
}

export async function fetchRecentEnded(hours = 1): Promise<CallSession[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("call_sessions" as never)
    .select("*")
    .in("status", ["ended", "failed"])
    .gte("ended_at", since)
    .order("ended_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as CallSession[];
}

export async function fetchTranscripts(sessionId: string, limit = 6): Promise<CallTranscript[]> {
  const { data, error } = await supabase
    .from("call_transcripts" as never)
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  // Reverse so oldest first.
  return ((data ?? []) as unknown as CallTranscript[]).reverse();
}

export type LinkedLead = {
  id: string;
  full_name: string;
  phone: string | null;
  location: string | null;
  budget: string | null;
  property_type: string | null;
  urgency: string | null;
  status: string;
  source: string;
};

export async function fetchLeadById(leadId: string): Promise<LinkedLead | null> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, full_name, phone, location, budget, property_type, urgency, status, source")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw error;
  return (data as LinkedLead | null) ?? null;
}

export function formatLiveDuration(session: CallSession, nowMs: number): string {
  if (session.status === "ended" || session.status === "failed") {
    const secs = session.duration_seconds ??
      (session.ended_at && session.started_at
        ? Math.max(0, Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000))
        : 0);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  const startMs = new Date(session.connected_at ?? session.started_at).getTime();
  const secs = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}