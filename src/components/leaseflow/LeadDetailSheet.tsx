import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BUDGETS, PROPERTY_TYPES, SOURCES, STATUSES, URGENCIES, statusClass, type Lead, type Status } from "@/lib/leaseflow";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { Phone, Trash2, Clock, Radio, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import LeadRemindersSection from "@/components/leaseflow/LeadRemindersSection";
import { handleStatusChange } from "@/lib/reminders";
import { useReminderRules } from "@/hooks/useReminderRules";
import { useAuth } from "@/hooks/useAuth";

export default function LeadDetailSheet({
  lead,
  open,
  onOpenChange,
  onChanged,
}: {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void;
}) {
  const [draft, setDraft] = useState<Lead | null>(lead);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { user } = useAuth();
  const { rules } = useReminderRules();

  useEffect(() => {
    setDraft(lead);
  }, [lead?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!draft) return null;

  const dirty = lead && JSON.stringify(lead) !== JSON.stringify(draft);
  const isVapi = draft.source?.toLowerCase().includes("vapi");

  const set = <K extends keyof Lead>(k: K, v: Lead[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    const statusChanged = lead ? lead.status !== draft.status : false;
    const { error } = await supabase
      .from("leads")
      .update({
        full_name: draft.full_name.trim(),
        phone: draft.phone?.trim() || null,
        location: draft.location?.trim() || null,
        budget: draft.budget || null,
        property_type: draft.property_type || null,
        urgency: draft.urgency || null,
        source: draft.source || "Manual",
        status: draft.status,
        notes: draft.notes?.trim() || null,
      })
      .eq("id", draft.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    if (statusChanged && user && rules) {
      try {
        await handleStatusChange({ userId: user.id, leadId: draft.id, newStatus: draft.status as Status, rules });
      } catch {}
    }
    toast.success("Lead updated");
    onChanged?.();
    onOpenChange(false);
  };

  const remove = async () => {
    if (!draft) return;
    if (!confirm(`Delete ${draft.full_name}? This can't be undone.`)) return;
    setDeleting(true);
    const { error } = await supabase.from("leads").delete().eq("id", draft.id);
    setDeleting(false);
    if (error) return toast.error(error.message);
    toast.success("Lead deleted");
    onChanged?.();
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="bg-surface border-border w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-xl">{draft.full_name || "Lead"}</SheetTitle>
            {isVapi && (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 text-primary px-1.5 py-0.5 text-[10px] font-medium">
                <Radio className="h-2.5 w-2.5" /> Vapi
              </span>
            )}
            <span className={cn("ml-auto rounded-full border px-2 py-0.5 text-xs", statusClass[draft.status as Status] ?? "")}>
              {draft.status}
            </span>
          </div>
          <SheetDescription className="flex items-center gap-1 text-xs">
            <Clock className="h-3 w-3" />
            Created {format(new Date(draft.created_at), "MMM d, yyyy 'at' h:mm a")} · {formatDistanceToNow(new Date(draft.created_at), { addSuffix: true })}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {draft.phone && (
            <a
              href={`tel:${draft.phone}`}
              className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5 text-sm font-medium text-primary hover:bg-primary/15 transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <Phone className="h-4 w-4" /> Call {draft.phone}
              </span>
              <ExternalLink className="h-3.5 w-3.5 opacity-60" />
            </a>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="d-name">Full name</Label>
              <Input id="d-name" value={draft.full_name} onChange={(e) => set("full_name", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="d-phone">Phone</Label>
              <Input id="d-phone" value={draft.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="d-loc">Location</Label>
            <Input id="d-loc" value={draft.location ?? ""} onChange={(e) => set("location", e.target.value)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={draft.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Source</Label>
              <Select value={draft.source} onValueChange={(v) => set("source", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Budget</Label>
              <Select value={draft.budget ?? ""} onValueChange={(v) => set("budget", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {BUDGETS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Property type</Label>
              <Select value={draft.property_type ?? ""} onValueChange={(v) => set("property_type", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {PROPERTY_TYPES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Move-in urgency</Label>
              <Select value={draft.urgency ?? ""} onValueChange={(v) => set("urgency", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {URGENCIES.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="d-notes">
              Call transcript / notes
              {isVapi && <span className="ml-2 text-xs font-normal text-muted-foreground">(captured from Vapi)</span>}
            </Label>
            <Textarea
              id="d-notes"
              rows={10}
              value={draft.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="What did the caller say? Specific buildings, deal-breakers, follow-up needed…"
              className="font-mono text-xs leading-relaxed"
            />
          </div>

          {user && (
            <div className="pt-2 border-t border-border">
              <LeadRemindersSection leadId={draft.id} userId={user.id} />
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
            <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={deleting} className="text-destructive hover:text-destructive gap-2">
              <Trash2 className="h-4 w-4" /> {deleting ? "Deleting…" : "Delete"}
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button type="button" onClick={save} disabled={!dirty || saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}