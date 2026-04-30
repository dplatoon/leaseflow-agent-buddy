import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CALL_OUTCOMES,
  OUTCOME_LABELS,
  OUTCOME_TONE,
  type CallLog,
  type CallOutcome,
  createCallLog,
  deleteCallLog,
  fetchCallsForLead,
  formatDuration,
  parseDurationInput,
} from "@/lib/calls";
import { createManualReminder } from "@/lib/reminders";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { Phone, PhoneIncoming, PhoneOutgoing, Plus, Radio, Trash2, Filter, RotateCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseFailureReason } from "@/lib/templates";

export type CallsFilter = "all" | "failures" | CallOutcome;

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function LeadCallsSection({
  leadId,
  userId,
  onRetryMessage,
}: {
  leadId: string;
  userId: string;
  onRetryMessage?: () => void;
}) {
  const [items, setItems] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<CallsFilter>("all");
  const [groupFailures, setGroupFailures] = useState(true);

  // Form state
  const [outcome, setOutcome] = useState<CallOutcome>("interested");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [durationStr, setDurationStr] = useState("");
  const [notes, setNotes] = useState("");
  const [nextAt, setNextAt] = useState("");
  const [createReminder, setCreateReminder] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await fetchCallsForLead(leadId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load call history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leadId]);

  // Reload when calls change anywhere (e.g. SendMessageDialog logs new attempts)
  useEffect(() => {
    const onChanged = () => void load();
    window.addEventListener("leaseflow:calls-changed", onChanged);
    return () => window.removeEventListener("leaseflow:calls-changed", onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const reset = () => {
    setOutcome("interested");
    setDirection("outbound");
    setDurationStr("");
    setNotes("");
    setNextAt("");
    setCreateReminder(true);
  };

  const onAdd = async () => {
    setAdding(true);
    try {
      const dur = durationStr ? parseDurationInput(durationStr) : null;
      const next = nextAt ? new Date(nextAt) : null;
      if (next && isNaN(next.getTime())) {
        toast.error("Invalid next-action date");
        return;
      }
      await createCallLog({
        userId,
        leadId,
        outcome,
        direction,
        durationSeconds: dur,
        notes,
        nextActionAt: next,
      });
      if (next && createReminder) {
        try {
          await createManualReminder({
            userId,
            leadId,
            dueAt: next,
            kind: "call",
            note: notes || `Follow-up after ${OUTCOME_LABELS[outcome].toLowerCase()}`,
          });
        } catch {
          toast.error("Call logged but reminder failed");
        }
      }
      toast.success("Call logged");
      reset();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to log call");
    } finally {
      setAdding(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm("Delete this call log?")) return;
    setBusyId(id);
    try { await deleteCallLog(id); await load(); } finally { setBusyId(null); }
  };

  // Derived: filtered list + outcome counts
  const outcomeCounts = items.reduce<Record<CallOutcome, number>>((acc, c) => {
    acc[c.outcome] = (acc[c.outcome] ?? 0) + 1;
    return acc;
  }, {} as Record<CallOutcome, number>);
  const failedItems = items.filter((c) => c.outcome === "message_failed");
  const failedCount = failedItems.length;

  const visibleItems = items.filter((c) => {
    if (filter === "all") return true;
    if (filter === "failures") return c.outcome === "message_failed";
    return c.outcome === filter;
  });

  // Group failures by reason for the dedicated failures view.
  const failureGroups = (() => {
    if (filter !== "failures" || !groupFailures) return null;
    const map = new Map<string, CallLog[]>();
    for (const c of failedItems) {
      const reason = parseFailureReason(c.notes);
      const arr = map.get(reason) ?? [];
      arr.push(c);
      map.set(reason, arr);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  })();

  const renderItem = (c: CallLog) => {
    const DirIcon = c.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
    const isFailed = c.outcome === "message_failed";
    return (
      <li key={c.id} className="rounded-lg border border-border bg-background p-2.5 text-xs space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <DirIcon className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-medium", OUTCOME_TONE[c.outcome])}>
              {OUTCOME_LABELS[c.outcome]}
            </span>
            {c.source === "vapi" && (
              <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 text-primary px-1 py-0.5 text-[9px]">
                <Radio className="h-2.5 w-2.5" /> vapi
              </span>
            )}
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {formatDuration(c.duration_seconds)}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground shrink-0">
            {format(new Date(c.created_at), "MMM d, h:mm a")} · {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
          </div>
        </div>
        {isFailed && (
          <div className="flex items-center gap-1.5 text-[10px] text-destructive">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span>Reason: {parseFailureReason(c.notes)}</span>
          </div>
        )}
        {c.notes && <div className="text-muted-foreground whitespace-pre-wrap">{c.notes}</div>}
        {c.next_action_at && (
          <div className="text-[10px] text-status-contacted">
            Next action · {format(new Date(c.next_action_at), "MMM d, h:mm a")}
          </div>
        )}
        <div className="flex justify-end gap-1">
          {isFailed && onRetryMessage && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px] px-2 text-primary hover:text-primary"
              onClick={onRetryMessage}
            >
              <RotateCw className="h-3 w-3 mr-1" /> Resend
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] px-2 text-destructive hover:text-destructive"
            onClick={() => onDelete(c.id)}
            disabled={busyId === c.id}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Phone className="h-4 w-4 text-muted-foreground" />
        <Label className="text-sm">Call history</Label>
        {items.length > 0 && (
          <span className="text-[10px] rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground tabular-nums">
            {items.length}
          </span>
        )}
        {failedCount > 0 && (
          <span className="text-[10px] rounded-full bg-destructive/15 text-destructive border border-destructive/30 px-1.5 py-0.5 tabular-nums inline-flex items-center gap-0.5">
            <AlertTriangle className="h-2.5 w-2.5" /> {failedCount} failed
          </span>
        )}
      </div>

      <details open className="rounded-lg border border-border bg-background/50">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium flex items-center gap-1.5">
          <Plus className="h-3 w-3" /> Log a call
        </summary>
        <div className="p-3 pt-0 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Outcome</Label>
              <Select value={outcome} onValueChange={(v) => setOutcome(v as CallOutcome)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CALL_OUTCOMES.map((o) => <SelectItem key={o} value={o}>{OUTCOME_LABELS[o]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Direction</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as "outbound" | "inbound")}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="outbound">Outbound</SelectItem>
                  <SelectItem value="inbound">Inbound</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Duration</Label>
              <Input
                placeholder="e.g. 2:30 or 90s"
                value={durationStr}
                onChange={(e) => setDurationStr(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Next action</Label>
              <Input
                type="datetime-local"
                value={nextAt}
                onChange={(e) => setNextAt(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <Textarea
            placeholder="What did they say? Specific buildings, deal-breakers, next steps…"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="text-xs"
          />
          {nextAt && (
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={createReminder}
                onChange={(e) => setCreateReminder(e.target.checked)}
                className="h-3 w-3 rounded border-border"
              />
              Also create a reminder for {format(new Date(nextAt), "MMM d, h:mm a")}
            </label>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={onAdd} disabled={adding} className="flex-1 h-8">
              {adding ? "Logging…" : "Log call"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { reset(); setNextAt(toLocalInput(new Date(Date.now() + 24 * 3600_000))); }} className="h-8 text-[11px]">
              +24h preset
            </Button>
          </div>
        </div>
      </details>

      {/* Filter chips */}
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          <Filter className="h-3 w-3 text-muted-foreground" />
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={cn(
              "rounded-full border px-2 py-0.5 transition-colors",
              filter === "all" ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            All <span className="opacity-70 tabular-nums">{items.length}</span>
          </button>
          {failedCount > 0 && (
            <button
              type="button"
              onClick={() => setFilter("failures")}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors",
                filter === "failures"
                  ? "bg-destructive/15 text-destructive border-destructive/30"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <AlertTriangle className="h-2.5 w-2.5" /> Failures <span className="opacity-70 tabular-nums">{failedCount}</span>
            </button>
          )}
          {(Object.keys(outcomeCounts) as CallOutcome[])
            .filter((o) => o !== "message_failed" && outcomeCounts[o] > 0)
            .sort((a, b) => outcomeCounts[b] - outcomeCounts[a])
            .map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setFilter(o)}
                className={cn(
                  "rounded-full border px-2 py-0.5 transition-colors",
                  filter === o ? OUTCOME_TONE[o] : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {OUTCOME_LABELS[o]} <span className="opacity-70 tabular-nums">{outcomeCounts[o]}</span>
              </button>
            ))}
          {filter === "failures" && failedCount > 1 && (
            <label className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={groupFailures}
                onChange={(e) => setGroupFailures(e.target.checked)}
                className="h-3 w-3 rounded border-border"
              />
              Group by reason
            </label>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-muted-foreground rounded-md border border-dashed border-border/60 px-3 py-2">
          No calls logged yet.
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="text-xs text-muted-foreground rounded-md border border-dashed border-border/60 px-3 py-2">
          No entries match this filter.
        </div>
      ) : failureGroups ? (
        <div className="space-y-3">
          {failureGroups.map(([reason, group]) => (
            <div key={reason} className="space-y-1.5">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive border border-destructive/30 px-2 py-0.5 font-medium">
                  <AlertTriangle className="h-2.5 w-2.5" /> {reason}
                </span>
                <span className="text-muted-foreground tabular-nums">{group.length}</span>
              </div>
              <ul className="space-y-2">{group.map(renderItem)}</ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="space-y-2">{visibleItems.map(renderItem)}</ul>
      )}
    </div>
  );
}