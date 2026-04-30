import { supabase } from "@/integrations/supabase/client";

export const CALL_OUTCOMES = [
  "no_answer",
  "voicemail",
  "interested",
  "not_qualified",
  "scheduled_viewing",
  "callback_requested",
  "wrong_number",
  "other",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  no_answer: "No answer",
  voicemail: "Voicemail",
  interested: "Interested",
  not_qualified: "Not qualified",
  scheduled_viewing: "Scheduled viewing",
  callback_requested: "Callback requested",
  wrong_number: "Wrong number",
  other: "Other",
};

/** Tailwind class hints per outcome — use semantic-ish status tokens. */
export const OUTCOME_TONE: Record<CallOutcome, string> = {
  no_answer: "bg-muted text-muted-foreground border-border",
  voicemail: "bg-muted text-muted-foreground border-border",
  interested: "bg-status-scheduled/15 text-status-scheduled border-status-scheduled/30",
  not_qualified: "bg-status-lost/15 text-status-lost border-status-lost/30",
  scheduled_viewing: "bg-status-closed/15 text-status-closed border-status-closed/30",
  callback_requested: "bg-status-contacted/15 text-status-contacted border-status-contacted/30",
  wrong_number: "bg-status-lost/15 text-status-lost border-status-lost/30",
  other: "bg-muted text-muted-foreground border-border",
};

export type CallDirection = "outbound" | "inbound";
export type CallSource = "manual" | "vapi";

export type CallLog = {
  id: string;
  user_id: string;
  lead_id: string;
  outcome: CallOutcome;
  direction: CallDirection;
  duration_seconds: number | null;
  notes: string | null;
  next_action_at: string | null;
  source: CallSource;
  vapi_call_id: string | null;
  created_at: string;
  updated_at: string;
};

export function dispatchCallsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("leaseflow:calls-changed"));
  }
}

export async function fetchCallsForLead(leadId: string): Promise<CallLog[]> {
  const { data, error } = await supabase
    .from("call_logs" as never)
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CallLog[];
}

export async function createCallLog(opts: {
  userId: string;
  leadId: string;
  outcome: CallOutcome;
  direction?: CallDirection;
  durationSeconds?: number | null;
  notes?: string | null;
  nextActionAt?: Date | null;
}): Promise<CallLog> {
  const { data, error } = await supabase
    .from("call_logs" as never)
    .insert({
      user_id: opts.userId,
      lead_id: opts.leadId,
      outcome: opts.outcome,
      direction: opts.direction ?? "outbound",
      duration_seconds: opts.durationSeconds ?? null,
      notes: opts.notes?.trim() || null,
      next_action_at: opts.nextActionAt ? opts.nextActionAt.toISOString() : null,
      source: "manual",
    } as never)
    .select("*")
    .single();
  if (error) throw error;
  dispatchCallsChanged();
  return data as unknown as CallLog;
}

export async function deleteCallLog(id: string): Promise<void> {
  const { error } = await supabase.from("call_logs" as never).delete().eq("id", id);
  if (error) throw error;
  dispatchCallsChanged();
}

export function formatDuration(secs: number | null | undefined): string {
  if (!secs || secs < 0) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** Parse "1m 30s", "90", "1:30", "1.5m" → seconds. Returns null if unparseable. */
export function parseDurationInput(raw: string): number | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  // mm:ss
  const colon = v.match(/^(\d+):(\d{1,2})$/);
  if (colon) return parseInt(colon[1]) * 60 + parseInt(colon[2]);
  // "1m 30s" or "1m" or "30s"
  const ms = v.match(/^(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/);
  if (ms && (ms[1] || ms[2])) return (parseInt(ms[1] || "0")) * 60 + parseInt(ms[2] || "0");
  // bare number = seconds
  if (/^\d+$/.test(v)) return parseInt(v);
  // 1.5 = minutes
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(parseFloat(v) * 60);
  return null;
}