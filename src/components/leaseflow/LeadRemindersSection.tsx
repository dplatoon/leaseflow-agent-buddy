import { useEffect, useState } from "react";
import {
  fetchRemindersForLead,
  completeReminder,
  snoozeReminder,
  deleteReminder,
  createManualReminder,
  isDue,
  type Reminder,
  REMINDER_KINDS,
  type ReminderKind,
} from "@/lib/reminders";
import { format, formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Bell, BellRing, Check, Clock, Plus, Trash2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function LeadRemindersSection({
  leadId,
  userId,
}: {
  leadId: string;
  userId: string;
}) {
  const [items, setItems] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [dueAt, setDueAt] = useState(() => toLocalInput(new Date(Date.now() + 24 * 3600_000)));
  const [kind, setKind] = useState<ReminderKind>("call");
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await fetchRemindersForLead(leadId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load reminders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leadId]);

  const onAdd = async () => {
    const date = new Date(dueAt);
    if (isNaN(date.getTime())) return toast.error("Invalid date");
    setAdding(true);
    try {
      await createManualReminder({ userId, leadId, dueAt: date, kind, note });
      setNote("");
      setDueAt(toLocalInput(new Date(Date.now() + 24 * 3600_000)));
      toast.success("Reminder added");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  };

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

  const pending = items.filter((r) => r.status === "pending");
  const past = items.filter((r) => r.status !== "pending").slice(0, 5);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-muted-foreground" />
        <Label className="text-sm">Follow-up reminders</Label>
        {pending.some(isDue) && (
          <span className="inline-flex items-center gap-1 rounded-full bg-status-lost/15 text-status-lost border border-status-lost/30 px-1.5 py-0.5 text-[10px] font-medium">
            <BellRing className="h-2.5 w-2.5" /> due now
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : pending.length === 0 ? (
        <div className="text-xs text-muted-foreground rounded-md border border-dashed border-border/60 px-3 py-2">
          No pending reminders.
        </div>
      ) : (
        <ul className="space-y-2">
          {pending.map((r) => {
            const due = isDue(r);
            return (
              <li
                key={r.id}
                className={cn(
                  "rounded-lg border bg-background p-2.5 text-xs space-y-1.5",
                  due ? "border-status-lost/40 bg-status-lost/5" : "border-border"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-medium capitalize">{r.kind}</span>
                    {r.auto_created && (
                      <span title="Auto-created from status rule" className="inline-flex items-center gap-0.5 rounded bg-primary/10 text-primary px-1 py-0.5 text-[9px]">
                        <Zap className="h-2.5 w-2.5" /> auto
                      </span>
                    )}
                  </div>
                  <div className={cn("flex items-center gap-1 text-[10px]", due ? "text-status-lost font-medium" : "text-muted-foreground")}>
                    <Clock className="h-2.5 w-2.5" />
                    {format(new Date(r.due_at), "MMM d, h:mm a")} · {formatDistanceToNow(new Date(r.due_at), { addSuffix: true })}
                  </div>
                </div>
                {r.note && <div className="text-muted-foreground">{r.note}</div>}
                <div className="flex flex-wrap gap-1 pt-0.5">
                  <Button size="sm" variant="outline" className="h-6 text-[11px] px-2 gap-1" onClick={() => onComplete(r.id)} disabled={busyId === r.id}>
                    <Check className="h-3 w-3" /> Done
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2" onClick={() => onSnooze(r.id, 1)} disabled={busyId === r.id}>+1h</Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2" onClick={() => onSnooze(r.id, 24)} disabled={busyId === r.id}>+1d</Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2 text-destructive hover:text-destructive ml-auto" onClick={() => onDelete(r.id)} disabled={busyId === r.id}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <details className="rounded-lg border border-border bg-background/50">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium flex items-center gap-1.5">
          <Plus className="h-3 w-3" /> Add reminder
        </summary>
        <div className="p-3 pt-0 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">When</Label>
              <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as ReminderKind)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REMINDER_KINDS.map((k) => <SelectItem key={k} value={k} className="capitalize">{k}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="h-8 text-xs" />
          <Button size="sm" onClick={onAdd} disabled={adding} className="w-full h-8">
            {adding ? "Adding…" : "Add reminder"}
          </Button>
        </div>
      </details>

      {past.length > 0 && (
        <details className="rounded-lg border border-border/60 bg-background/30">
          <summary className="cursor-pointer px-3 py-1.5 text-[11px] text-muted-foreground">
            History ({past.length})
          </summary>
          <ul className="px-3 pb-2 space-y-1 text-[11px] text-muted-foreground">
            {past.map((r) => (
              <li key={r.id} className="flex items-center justify-between">
                <span className="capitalize">{r.kind} · {r.status}</span>
                <span>{format(new Date(r.completed_at ?? r.due_at), "MMM d")}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}