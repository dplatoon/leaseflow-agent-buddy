import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/leaseflow/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchPendingReminders,
  completeReminder,
  snoozeReminder,
  deleteReminder,
  isDue,
  type Reminder,
} from "@/lib/reminders";
import type { Lead } from "@/lib/leaseflow";
import { Button } from "@/components/ui/button";
import { format, formatDistanceToNow } from "date-fns";
import { BellRing, Check, Clock, Phone, Trash2, Zap, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import LeadDetailSheet from "@/components/leaseflow/LeadDetailSheet";
import { toast } from "sonner";

export const Route = createFileRoute("/reminders")({
  head: () => ({ meta: [{ title: "Reminders — LeaseFlow" }] }),
  component: RemindersPage,
});

type ReminderWithLead = Reminder & { lead?: Lead };

function RemindersPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ReminderWithLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"due" | "all">("due");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [leadsCache, setLeadsCache] = useState<Record<string, Lead>>({});

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const reminders = await fetchPendingReminders();
      // Hydrate lead info for each reminder
      const leadIds = Array.from(new Set(reminders.map((r) => r.lead_id)));
      let leadsById: Record<string, Lead> = {};
      if (leadIds.length > 0) {
        const { data } = await supabase.from("leads").select("*").in("id", leadIds);
        leadsById = Object.fromEntries(((data ?? []) as Lead[]).map((l) => [l.id, l]));
      }
      setLeadsCache(leadsById);
      setItems(reminders.map((r) => ({ ...r, lead: leadsById[r.lead_id] })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load reminders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);
  useEffect(() => {
    const onChange = () => load();
    window.addEventListener("leaseflow:reminders-changed", onChange);
    window.addEventListener("leaseflow:lead-created", onChange);
    return () => {
      window.removeEventListener("leaseflow:reminders-changed", onChange);
      window.removeEventListener("leaseflow:lead-created", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const visible = useMemo(() => {
    if (filter === "due") return items.filter(isDue);
    return items;
  }, [items, filter]);

  const dueCount = useMemo(() => items.filter(isDue).length, [items]);

  const onComplete = async (id: string) => {
    setBusyId(id);
    try { await completeReminder(id); await load(); } finally { setBusyId(null); }
  };
  const onSnooze = async (id: string, hours: number) => {
    setBusyId(id);
    try { await snoozeReminder(id, hours); await load(); } finally { setBusyId(null); }
  };
  const onDelete = async (id: string) => {
    if (!confirm("Delete this reminder?")) return;
    setBusyId(id);
    try { await deleteReminder(id); await load(); } finally { setBusyId(null); }
  };

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Reminders</h1>
            <p className="text-sm text-muted-foreground">
              {items.length} pending · {dueCount > 0 ? <span className="text-status-lost font-medium">{dueCount} due now</span> : "nothing due"}.
              {" "}
              <Link to="/settings" className="underline underline-offset-2">Configure rules</Link>
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant={filter === "due" ? "default" : "outline"} onClick={() => setFilter("due")} className="gap-2">
              <BellRing className="h-3.5 w-3.5" /> Due ({dueCount})
            </Button>
            <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
              All pending ({items.length})
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center text-sm text-muted-foreground">
            <Inbox className="mx-auto h-8 w-8 mb-2 opacity-50" />
            {filter === "due" ? "Nothing's due. Nice." : "No pending reminders."}
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map((r) => {
              const due = isDue(r);
              const lead = r.lead ?? leadsCache[r.lead_id];
              return (
                <li
                  key={r.id}
                  className={cn(
                    "rounded-xl border bg-surface p-4 flex flex-wrap items-start gap-4",
                    due ? "border-status-lost/40 ring-1 ring-status-lost/20" : "border-border"
                  )}
                >
                  <button
                    onClick={() => { if (lead) { setOpenLeadId(lead.id); setSheetOpen(true); } }}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{lead?.full_name ?? "Unknown lead"}</span>
                      {lead?.status && (
                        <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                          {lead.status}
                        </span>
                      )}
                      <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] capitalize">{r.kind}</span>
                      {r.auto_created && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 text-primary px-1.5 py-0.5 text-[10px]">
                          <Zap className="h-2.5 w-2.5" /> auto
                        </span>
                      )}
                    </div>
                    <div className={cn("mt-1 inline-flex items-center gap-1 text-xs", due ? "text-status-lost font-medium" : "text-muted-foreground")}>
                      <Clock className="h-3 w-3" />
                      {format(new Date(r.due_at), "MMM d, h:mm a")} · {formatDistanceToNow(new Date(r.due_at), { addSuffix: true })}
                    </div>
                    {r.note && <div className="mt-1 text-xs text-muted-foreground">{r.note}</div>}
                  </button>

                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    {lead?.phone && (
                      <a
                        href={`tel:${lead.phone}`}
                        className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 text-primary px-2 py-1 text-xs hover:bg-primary/15"
                      >
                        <Phone className="h-3 w-3" /> Call
                      </a>
                    )}
                    <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => onComplete(r.id)} disabled={busyId === r.id}>
                      <Check className="h-3 w-3" /> Done
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => onSnooze(r.id, 1)} disabled={busyId === r.id}>+1h</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => onSnooze(r.id, 24)} disabled={busyId === r.id}>+1d</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive hover:text-destructive" onClick={() => onDelete(r.id)} disabled={busyId === r.id}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <LeadDetailSheet
        lead={openLeadId ? leadsCache[openLeadId] ?? null : null}
        open={sheetOpen}
        onOpenChange={(v) => { setSheetOpen(v); if (!v) setOpenLeadId(null); }}
        onChanged={load}
      />
    </AppShell>
  );
}