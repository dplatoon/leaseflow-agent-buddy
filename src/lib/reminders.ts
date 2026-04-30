import { supabase } from "@/integrations/supabase/client";
import type { Status } from "./leaseflow";

export type ReminderKind = "call" | "message" | "custom";
export const REMINDER_KINDS: ReminderKind[] = ["call", "message", "custom"];

export type ReminderStatus = "pending" | "done" | "snoozed";

export type Reminder = {
  id: string;
  user_id: string;
  lead_id: string;
  due_at: string;
  kind: ReminderKind;
  note: string | null;
  status: ReminderStatus;
  auto_created: boolean;
  triggered_by_status: string | null;
  completed_at: string | null;
  created_at: string;
};

export type ReminderRules = {
  user_id: string;
  new_hours: number | null;
  contacted_hours: number | null;
  scheduled_hours: number | null;
  closed_hours: number | null;
  lost_hours: number | null;
  enabled: boolean;
};

export const DEFAULT_RULES: Omit<ReminderRules, "user_id"> = {
  new_hours: 24,
  contacted_hours: 48,
  scheduled_hours: 24,
  closed_hours: null,
  lost_hours: null,
  enabled: true,
};

const STATUS_TO_RULE_KEY: Record<Status, keyof Omit<ReminderRules, "user_id" | "enabled">> = {
  New: "new_hours",
  Contacted: "contacted_hours",
  Scheduled: "scheduled_hours",
  Closed: "closed_hours",
  Lost: "lost_hours",
};

export function offsetForStatus(rules: ReminderRules | null, status: Status): number | null {
  if (!rules || !rules.enabled) return null;
  const v = rules[STATUS_TO_RULE_KEY[status]];
  return typeof v === "number" && v > 0 ? v : null;
}

export function dispatchRemindersChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("leaseflow:reminders-changed"));
  }
}

export async function fetchRules(userId: string): Promise<ReminderRules> {
  const { data } = await supabase
    .from("reminder_rules" as never)
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as unknown as ReminderRules;
  // Fallback to defaults if row missing (shouldn't happen — trigger seeds it)
  return { user_id: userId, ...DEFAULT_RULES };
}

export async function saveRules(rules: ReminderRules): Promise<void> {
  const { error } = await supabase
    .from("reminder_rules" as never)
    .upsert({
      user_id: rules.user_id,
      new_hours: rules.new_hours,
      contacted_hours: rules.contacted_hours,
      scheduled_hours: rules.scheduled_hours,
      closed_hours: rules.closed_hours,
      lost_hours: rules.lost_hours,
      enabled: rules.enabled,
    } as never);
  if (error) throw error;
}

/**
 * Create an auto-rule reminder for a lead in a given status, if a rule exists.
 * Returns the inserted reminder id, or null if no rule applied.
 */
export async function createAutoReminder(opts: {
  userId: string;
  leadId: string;
  status: Status;
  rules: ReminderRules;
  fromTime?: Date;
}): Promise<string | null> {
  const hours = offsetForStatus(opts.rules, opts.status);
  if (hours == null) return null;
  const due = new Date((opts.fromTime ?? new Date()).getTime() + hours * 3600_000);
  const { data, error } = await supabase
    .from("lead_reminders" as never)
    .insert({
      user_id: opts.userId,
      lead_id: opts.leadId,
      due_at: due.toISOString(),
      kind: "call",
      status: "pending",
      auto_created: true,
      triggered_by_status: opts.status,
      note: `Follow up — lead in ${opts.status}`,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  dispatchRemindersChanged();
  return (data as { id: string }).id;
}

/**
 * On status change: auto-complete any pending auto-created reminders for this
 * lead, then create a new auto-reminder for the new status (if a rule exists).
 */
export async function handleStatusChange(opts: {
  userId: string;
  leadId: string;
  newStatus: Status;
  rules: ReminderRules;
}): Promise<void> {
  // Mark prior pending auto-reminders as done
  await supabase
    .from("lead_reminders" as never)
    .update({ status: "done", completed_at: new Date().toISOString() } as never)
    .eq("lead_id", opts.leadId)
    .eq("status", "pending")
    .eq("auto_created", true);
  await createAutoReminder({
    userId: opts.userId,
    leadId: opts.leadId,
    status: opts.newStatus,
    rules: opts.rules,
  });
  dispatchRemindersChanged();
}

export async function completeReminder(id: string): Promise<void> {
  const { error } = await supabase
    .from("lead_reminders" as never)
    .update({ status: "done", completed_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) throw error;
  dispatchRemindersChanged();
}

export async function snoozeReminder(id: string, hours: number): Promise<void> {
  const due = new Date(Date.now() + hours * 3600_000).toISOString();
  const { error } = await supabase
    .from("lead_reminders" as never)
    .update({ due_at: due, status: "pending" } as never)
    .eq("id", id);
  if (error) throw error;
  dispatchRemindersChanged();
}

export async function deleteReminder(id: string): Promise<void> {
  const { error } = await supabase.from("lead_reminders" as never).delete().eq("id", id);
  if (error) throw error;
  dispatchRemindersChanged();
}

export async function createManualReminder(opts: {
  userId: string;
  leadId: string;
  dueAt: Date;
  kind: ReminderKind;
  note?: string;
}): Promise<void> {
  const { error } = await supabase.from("lead_reminders" as never).insert({
    user_id: opts.userId,
    lead_id: opts.leadId,
    due_at: opts.dueAt.toISOString(),
    kind: opts.kind,
    note: opts.note?.trim() || null,
    status: "pending",
    auto_created: false,
  } as never);
  if (error) throw error;
  dispatchRemindersChanged();
}

export function isDue(r: Pick<Reminder, "due_at" | "status">): boolean {
  return r.status === "pending" && new Date(r.due_at).getTime() <= Date.now();
}

/** Fetch the current user's pending reminders (optionally only due now). */
export async function fetchPendingReminders(opts?: { dueOnly?: boolean; limit?: number }) {
  let q = supabase
    .from("lead_reminders" as never)
    .select("*")
    .eq("status", "pending")
    .order("due_at", { ascending: true });
  if (opts?.dueOnly) q = q.lte("due_at", new Date().toISOString());
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as Reminder[];
}

export async function fetchRemindersForLead(leadId: string): Promise<Reminder[]> {
  const { data, error } = await supabase
    .from("lead_reminders" as never)
    .select("*")
    .eq("lead_id", leadId)
    .order("due_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Reminder[];
}