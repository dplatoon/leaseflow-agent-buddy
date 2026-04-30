import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Link as LinkIcon, MessageSquare, Phone, Send, Sparkles } from "lucide-react";
import {
  buildLink,
  fetchTemplates,
  logMessageSent,
  normalizePhone,
  renderTemplate,
  type MessageChannel,
  type MessageTemplate,
} from "@/lib/templates";
import type { Lead } from "@/lib/leaseflow";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "@tanstack/react-router";

const STAGGER_MS = 350;

export default function SendMessageDialog({
  leads,
  open,
  onOpenChange,
  agentName,
}: {
  leads: Lead[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  agentName: string | null;
}) {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [channel, setChannel] = useState<MessageChannel>("whatsapp");
  const [bodyOverride, setBodyOverride] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const isBulk = leads.length > 1;
  const valid = leads.filter((l) => normalizePhone(l.phone).length >= 6);
  const skipped = leads.length - valid.length;
  const previewLead = valid[0] ?? leads[0] ?? null;

  // Load templates when dialog opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchTemplates()
      .then((rows) => {
        setTemplates(rows);
        if (rows.length > 0) {
          const def = rows.find((r) => r.is_default && r.channel === channel) ?? rows.find((r) => r.channel === channel) ?? rows[0];
          setTemplateId(def.id);
          setChannel(def.channel);
        } else {
          setTemplateId("");
        }
        setBodyOverride(null);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load templates"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null;
  const effectiveBody = bodyOverride ?? selectedTemplate?.body ?? "";

  const previewMessage = useMemo(() => {
    if (!previewLead || !effectiveBody) return "";
    return renderTemplate(effectiveBody, previewLead, agentName);
  }, [effectiveBody, previewLead, agentName]);

  const previewLink = useMemo(() => {
    if (!previewLead) return "";
    return buildLink(channel, previewLead.phone ?? "", previewMessage);
  }, [channel, previewLead, previewMessage]);

  const handleSend = async () => {
    if (!user) return;
    if (!effectiveBody.trim()) {
      toast.error("Pick or type a message first");
      return;
    }
    if (valid.length === 0) {
      toast.error("None of the selected leads have a valid phone number");
      return;
    }
    setSending(true);
    try {
      // Bulk: open one tab per lead, staggered to avoid popup-blocker / overload.
      let opened = 0;
      for (let i = 0; i < valid.length; i++) {
        const lead = valid[i];
        const msg = renderTemplate(effectiveBody, lead, agentName);
        const link = buildLink(channel, lead.phone ?? "", msg);
        if (!link) continue;
        // First tab synchronously to maximize popup-blocker bypass.
        if (i === 0) {
          const w = window.open(link, "_blank", "noopener,noreferrer");
          if (w) opened++;
        } else {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, STAGGER_MS));
          const w = window.open(link, "_blank", "noopener,noreferrer");
          if (w) opened++;
        }
        // Fire-and-forget log (don't block UI)
        void logMessageSent({
          userId: user.id,
          leadId: lead.id,
          channel,
          templateName: selectedTemplate?.name ?? "Custom message",
          preview: msg.slice(0, 280),
        });
      }
      if (opened === 0) {
        toast.error("Browser blocked the popup. Allow popups for this site and try again.");
      } else if (opened < valid.length) {
        toast.warning(`Opened ${opened} of ${valid.length}. Allow popups to send the rest.`);
      } else {
        toast.success(`Opened ${opened} ${channel === "sms" ? "SMS" : "WhatsApp"} ${opened === 1 ? "thread" : "threads"}`);
      }
      if (skipped > 0) {
        toast.warning(`${skipped} skipped — no phone number`);
      }
      onOpenChange(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Send {channel === "sms" ? "SMS" : "WhatsApp"} {isBulk ? `to ${leads.length} leads` : ""}
          </DialogTitle>
          <DialogDescription>
            {isBulk
              ? `${valid.length} will open${skipped > 0 ? `, ${skipped} skipped (no phone)` : ""}. One browser tab per lead.`
              : previewLead?.phone
                ? `Sending to ${previewLead.full_name} · ${previewLead.phone}`
                : "This lead has no phone number."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-sm text-center text-muted-foreground">Loading templates…</div>
        ) : templates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center space-y-3">
            <Sparkles className="h-6 w-6 text-muted-foreground mx-auto" />
            <div className="text-sm">You don't have any saved templates yet.</div>
            <Button asChild size="sm" variant="outline">
              <Link to="/settings" onClick={() => onOpenChange(false)}>Create one in Settings →</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Template</Label>
                <Select
                  value={templateId}
                  onValueChange={(v) => {
                    setTemplateId(v);
                    const t = templates.find((x) => x.id === v);
                    if (t) { setChannel(t.channel); setBodyOverride(null); }
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Choose a template" /></SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                        {t.is_default && <span className="ml-1 text-[10px] text-muted-foreground">· default</span>}
                        <span className="ml-1 text-[10px] uppercase text-muted-foreground">· {t.channel}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Channel</Label>
                <Select value={channel} onValueChange={(v) => setChannel(v as MessageChannel)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Message {!isBulk && previewLead ? "(preview)" : "(template body — preview shown below)"}</Label>
                {bodyOverride !== null && (
                  <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setBodyOverride(null)}>
                    Reset to template
                  </button>
                )}
              </div>
              <Textarea
                rows={6}
                value={effectiveBody}
                onChange={(e) => setBodyOverride(e.target.value)}
                className="text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Variables: <code>{"{{name}}"}</code> <code>{"{{first_name}}"}</code> <code>{"{{phone}}"}</code> <code>{"{{location}}"}</code> <code>{"{{budget}}"}</code> <code>{"{{property_type}}"}</code> <code>{"{{agent_name}}"}</code>
              </p>
            </div>

            {previewLead && previewMessage && (
              <div className="rounded-lg border border-border bg-background p-3 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Preview · {previewLead.full_name}{previewLead.phone ? ` · ${previewLead.phone}` : ""}</span>
                  {previewLink && (
                    <a
                      href={previewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <LinkIcon className="h-3 w-3" /> open
                    </a>
                  )}
                </div>
                <div className="text-sm whitespace-pre-wrap">{previewMessage}</div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button
            onClick={handleSend}
            disabled={sending || loading || templates.length === 0 || valid.length === 0 || !effectiveBody.trim()}
            className="gap-2"
          >
            {channel === "sms" ? <Phone className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {sending ? "Opening…" : isBulk ? `Open ${valid.length} tabs` : "Open chat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}