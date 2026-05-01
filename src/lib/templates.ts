import { supabase } from "@/integrations/supabase/client";
import type { Lead } from "@/lib/leaseflow";

export type MessageChannel = "whatsapp" | "sms";

export type MessageTemplate = {
  id: string;
  user_id: string;
  name: string;
  body: string;
  channel: MessageChannel;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

/** Variables exposed to templates. Keep keys lowercase, snake_case. */
export const TEMPLATE_VARS = [
  { key: "name", desc: "Lead full name" },
  { key: "first_name", desc: "First word of lead name" },
  { key: "phone", desc: "Lead phone" },
  { key: "location", desc: "Requested location" },
  { key: "budget", desc: "Budget" },
  { key: "property_type", desc: "Property type" },
  { key: "urgency", desc: "Move-in urgency" },
  { key: "agent_name", desc: "Your name" },
] as const;
export type TemplateVarKey = (typeof TEMPLATE_VARS)[number]["key"];

function buildVars(lead: Lead, agentName: string | null): Record<TemplateVarKey, string> {
  const first = (lead.full_name ?? "").trim().split(/\s+/)[0] ?? "";
  return {
    name: lead.full_name ?? "",
    first_name: first,
    phone: lead.phone ?? "",
    location: lead.location ?? "",
    budget: lead.budget ?? "",
    property_type: lead.property_type ?? "",
    urgency: lead.urgency ?? "",
    agent_name: agentName ?? "",
  };
}

/** Render a template body with {{var}} replacements. Unknown vars are left as-is. */
export function renderTemplate(body: string, lead: Lead, agentName: string | null): string {
  const vars = buildVars(lead, agentName);
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, raw: string) => {
    const k = raw.toLowerCase().trim() as TemplateVarKey;
    const v = vars[k];
    return v ?? `{{${raw}}}`;
  });
}

/** Strip non-digits except a leading +; result has no spaces. */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const trimmed = phone.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/[^\d]/g, "");
}

export function buildWhatsAppLink(phone: string, message: string): string {
  const num = normalizePhone(phone).replace(/^\+/, "");
  if (!num) return "";
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
}

export function buildSmsLink(phone: string, message: string): string {
  const num = normalizePhone(phone);
  if (!num) return "";
  // ?body= works on both iOS and Android
  return `sms:${num}?body=${encodeURIComponent(message)}`;
}

export function buildLink(channel: MessageChannel, phone: string, message: string): string {
  return channel === "sms" ? buildSmsLink(phone, message) : buildWhatsAppLink(phone, message);
}

export async function fetchTemplates(): Promise<MessageTemplate[]> {
  const { data, error } = await supabase
    .from("message_templates" as never)
    .select("*")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as MessageTemplate[];
}

export async function createTemplate(opts: {
  userId: string;
  name: string;
  body: string;
  channel: MessageChannel;
  isDefault?: boolean;
}): Promise<MessageTemplate> {
  if (opts.isDefault) {
    // Clear any existing default for this channel
    await supabase
      .from("message_templates" as never)
      .update({ is_default: false } as never)
      .eq("user_id", opts.userId)
      .eq("channel", opts.channel);
  }
  const { data, error } = await supabase
    .from("message_templates" as never)
    .insert({
      user_id: opts.userId,
      name: opts.name.trim(),
      body: opts.body,
      channel: opts.channel,
      is_default: !!opts.isDefault,
    } as never)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as MessageTemplate;
}

export async function updateTemplate(t: MessageTemplate): Promise<void> {
  if (t.is_default) {
    await supabase
      .from("message_templates" as never)
      .update({ is_default: false } as never)
      .eq("user_id", t.user_id)
      .eq("channel", t.channel)
      .neq("id", t.id);
  }
  const { error } = await supabase
    .from("message_templates" as never)
    .update({
      name: t.name.trim(),
      body: t.body,
      channel: t.channel,
      is_default: t.is_default,
    } as never)
    .eq("id", t.id);
  if (error) throw error;
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from("message_templates" as never).delete().eq("id", id);
  if (error) throw error;
}

export type MessageDeliveryStatus = "sent" | "failed";

/** Best-effort: log a message attempt (sent or failed) against a lead. */
export async function logMessageAttempt(opts: {
  userId: string;
  leadId: string;
  channel: MessageChannel;
  templateName: string;
  preview: string;
  status: MessageDeliveryStatus;
  failureReason?: string;
}): Promise<void> {
  const channelLabel = opts.channel === "sms" ? "SMS" : "WhatsApp";
  const header =
    opts.status === "failed"
      ? `${channelLabel} failed · "${opts.templateName}"${opts.failureReason ? ` — ${opts.failureReason}` : ""}`
      : `${channelLabel} · "${opts.templateName}"`;
  const note = `${header}\n\n${opts.preview}`;
  await supabase.from("call_logs" as never).insert({
    user_id: opts.userId,
    lead_id: opts.leadId,
    outcome: opts.status === "failed" ? "message_failed" : "message_sent",
    direction: "outbound",
    notes: note,
    source: "manual",
  } as never);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("leaseflow:calls-changed"));
  }
}

/** Backwards-compatible alias. */
export async function logMessageSent(opts: {
  userId: string;
  leadId: string;
  channel: MessageChannel;
  templateName: string;
  preview: string;
}): Promise<void> {
  return logMessageAttempt({ ...opts, status: "sent" });
}

/** Extract the failure reason we encoded into the call log note header. */
export function parseFailureReason(note: string | null | undefined): string {
  if (!note) return "Unknown";
  const firstLine = note.split("\n", 1)[0] ?? "";
  // Header shape: "WhatsApp failed · "tplName" — <reason>"
  const m = firstLine.match(/—\s*(.+?)\s*$/);
  if (m && m[1]) return m[1].trim();
  return "Unknown";
}

/** Channel inferred from the note header ("WhatsApp" or "SMS"). */
export function parseChannelFromNote(note: string | null | undefined): MessageChannel {
  if (!note) return "whatsapp";
  return /^SMS\b/i.test(note) ? "sms" : "whatsapp";
}