import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/leaseflow/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { STATUSES, statusClass, BUDGETS, PROPERTY_TYPES, URGENCIES, type Lead, type Status } from "@/lib/leaseflow";
import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
} from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Phone, Clock, Radio, AlertTriangle, X, ArrowRight, UserPlus, Download, Filter } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import LeadDetailSheet from "@/components/leaseflow/LeadDetailSheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { handleStatusChange } from "@/lib/reminders";
import { useReminderRules } from "@/hooks/useReminderRules";
import { useNewLeadRealtime } from "@/hooks/useNewLeadRealtime";

export const Route = createFileRoute("/pipeline")({
  head: () => ({ meta: [{ title: "Pipeline — LeaseFlow" }] }),
  component: PipelinePage,
});

const urgencyTone: Record<string, string> = {
  ASAP: "bg-status-lost/15 text-status-lost border-status-lost/30",
  "Within 1 month": "bg-status-scheduled/15 text-status-scheduled border-status-scheduled/30",
  "1–3 months": "bg-status-contacted/15 text-status-contacted border-status-contacted/30",
  Flexible: "bg-muted text-muted-foreground border-border",
};

const STALE_HOURS = 24;
const STALE_STATUSES = new Set<Status>(["New", "Contacted"]);
function isStale(lead: Lead) {
  if (!STALE_STATUSES.has(lead.status as Status)) return false;
  return Date.now() - new Date(lead.created_at).getTime() > STALE_HOURS * 60 * 60 * 1000;
}

// Rough budget midpoints (in thousands) for column totals.
const BUDGET_MIDPOINT_K: Record<string, number> = {
  "Under 20k": 15,
  "20k–40k": 30,
  "40k–60k": 50,
  "60k–100k": 80,
  "100k+": 120,
};
function leadBudgetK(l: Lead): number {
  return l.budget ? BUDGET_MIDPOINT_K[l.budget] ?? 0 : 0;
}
function fmtK(k: number) {
  if (k >= 1000) return `${(k / 1000).toFixed(1)}M`;
  return `${Math.round(k)}k`;
}

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

function PipelinePage() {
  const { user } = useAuth();
  const { rules } = useReminderRules();
  const isMobile = useIsMobile();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [staleOnly, setStaleOnly] = useState(false);
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [propTypes, setPropTypes] = useState<Set<string>>(new Set());
  const [urgencies, setUrgencies] = useState<Set<string>>(new Set());
  const [budgets, setBudgets] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [avgResponseMin, setAvgResponseMin] = useState<number | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
    setLeads((data ?? []) as Lead[]);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user]);

  // Realtime: refresh on any lead change for this user
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`pipeline-leads-${user.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            const updated = payload.new as Lead;
            setLeads((ls) => ls.map((l) => (l.id === updated.id ? updated : l)));
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as Lead;
            setLeads((ls) => ls.filter((l) => l.id !== old.id));
          }
          // INSERT handled by useNewLeadRealtime
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  useNewLeadRealtime((lead) => {
    setLeads((prev) => (prev.some((l) => l.id === lead.id) ? prev : [lead, ...prev]));
    setHighlightIds((s) => new Set(s).add(lead.id));
    setTimeout(() => {
      setHighlightIds((s) => { const n = new Set(s); n.delete(lead.id); return n; });
    }, 2600);
  });

  useEffect(() => {
    const onCreated = () => load();
    window.addEventListener("leaseflow:lead-created", onCreated);
    return () => window.removeEventListener("leaseflow:lead-created", onCreated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Compute average response time today (created → first call_log)
  useEffect(() => {
    if (!user) return;
    const today = startOfDay(new Date()).toISOString();
    (async () => {
      const { data: todayLeads } = await supabase
        .from("leads").select("id, created_at").gte("created_at", today);
      const ids = (todayLeads ?? []).map((l) => l.id);
      if (ids.length === 0) { setAvgResponseMin(null); return; }
      const { data: logs } = await supabase
        .from("call_logs").select("lead_id, created_at").in("lead_id", ids)
        .order("created_at", { ascending: true });
      const firstByLead = new Map<string, string>();
      for (const r of (logs ?? []) as { lead_id: string; created_at: string }[]) {
        if (!firstByLead.has(r.lead_id)) firstByLead.set(r.lead_id, r.created_at);
      }
      const diffs: number[] = [];
      for (const l of (todayLeads ?? []) as { id: string; created_at: string }[]) {
        const f = firstByLead.get(l.id);
        if (f) diffs.push((new Date(f).getTime() - new Date(l.created_at).getTime()) / 60000);
      }
      setAvgResponseMin(diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null);
    })();
  }, [user, leads.length]);

  // Daily summary numbers
  const summary = useMemo(() => {
    const today = startOfDay(new Date()).getTime();
    const yest = today - 24 * 3600 * 1000;
    let todayCount = 0, yestCount = 0, todayClosed = 0;
    for (const l of leads) {
      const t = new Date(l.created_at).getTime();
      if (t >= today) {
        todayCount++;
        if (l.status === "Closed") todayClosed++;
      } else if (t >= yest) {
        yestCount++;
      }
    }
    const conv = todayCount ? (todayClosed / todayCount) * 100 : 0;
    return { todayCount, yestCount, conv };
  }, [leads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = leads;
    if (q) out = out.filter((l) =>
      [l.full_name, l.phone, l.location, l.budget].some((v) => v?.toLowerCase().includes(q))
    );
    if (staleOnly) out = out.filter(isStale);
    if (propTypes.size) out = out.filter((l) => l.property_type && propTypes.has(l.property_type));
    if (urgencies.size) out = out.filter((l) => l.urgency && urgencies.has(l.urgency));
    if (budgets.size) out = out.filter((l) => l.budget && budgets.has(l.budget));
    return out;
  }, [leads, search, staleOnly, propTypes, urgencies, budgets]);

  const totalStale = useMemo(() => leads.filter(isStale).length, [leads]);
  const openLead = openLeadId ? leads.find((l) => l.id === openLeadId) ?? null : null;
  const openCard = (id: string) => { setOpenLeadId(id); setSheetOpen(true); };

  const onDragStart = (e: DragStartEvent) => setActiveId(e.active.id as string);
  const onDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const id = e.active.id as string;
    const newStatus = e.over?.id as Status | undefined;
    if (!newStatus) return;
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.status === newStatus) return;
    const prev = leads;
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status: newStatus } : l)));
    const { error } = await supabase.from("leads").update({ status: newStatus }).eq("id", id);
    if (error) { setLeads(prev); toast.error(error.message); return; }
    toast.success(`Moved to ${newStatus}`);
    if (user && rules) {
      try { await handleStatusChange({ userId: user.id, leadId: id, newStatus, rules }); } catch {}
    }
  };

  const activeLead = activeId ? filtered.find((l) => l.id === activeId) : null;

  const togglePill = (set: Set<string>, setter: (s: Set<string>) => void, value: string) => {
    const n = new Set(set);
    if (n.has(value)) n.delete(value); else n.add(value);
    setter(n);
  };
  const clearFilters = () => {
    setPropTypes(new Set()); setUrgencies(new Set()); setBudgets(new Set()); setStaleOnly(false); setSearch("");
  };
  const activeFilterCount = propTypes.size + urgencies.size + budgets.size + (staleOnly ? 1 : 0) + (search ? 1 : 0);

  // Selection helpers
  const toggleSelect = (id: string) => {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const clearSelection = () => setSelected(new Set());

  const bulkMove = async (status: Status) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const prev = leads;
    setLeads((ls) => ls.map((l) => (selected.has(l.id) ? { ...l, status } : l)));
    const { error } = await supabase.from("leads").update({ status }).in("id", ids);
    setBulkBusy(false);
    if (error) { setLeads(prev); toast.error(error.message); return; }
    toast.success(`Moved ${ids.length} lead${ids.length === 1 ? "" : "s"} to ${status}`);
    if (user && rules) {
      await Promise.all(ids.map((id) =>
        handleStatusChange({ userId: user.id, leadId: id, newStatus: status, rules }).catch(() => {})
      ));
    }
    clearSelection();
  };

  const bulkExport = () => {
    const rows = leads.filter((l) => selected.has(l.id));
    if (rows.length === 0) return;
    const headers = ["id", "full_name", "phone", "location", "budget", "property_type", "urgency", "source", "status", "created_at"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc((r as unknown as Record<string, unknown>)[h])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pipeline-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} lead${rows.length === 1 ? "" : "s"}`);
  };

  const trendArrow = summary.todayCount === summary.yestCount ? "→" : summary.todayCount > summary.yestCount ? "↑" : "↓";
  const trendTone = summary.todayCount >= summary.yestCount ? "text-status-closed" : "text-status-lost";

  return (
    <AppShell>
      <div className="space-y-4">
        {/* Daily summary banner */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-border bg-gradient-to-br from-surface to-background p-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Leads today</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">{summary.todayCount}</span>
              <span className={cn("text-sm font-medium", trendTone)}>{trendArrow} {summary.yestCount} yesterday</span>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Conversion (today)</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{summary.conv.toFixed(1)}%</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Avg response time</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {avgResponseMin == null ? "—" : avgResponseMin < 60 ? `${Math.round(avgResponseMin)}m` : `${(avgResponseMin / 60).toFixed(1)}h`}
            </div>
          </div>
        </div>

        {/* Header + search */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
            <p className="text-sm text-muted-foreground">
              {filtered.length} of {leads.length} shown
              {totalStale > 0 && (<> · <span className="text-status-lost font-medium">{totalStale} stale</span></>)}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant={staleOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setStaleOnly((v) => !v)}
              className="gap-2"
              disabled={totalStale === 0 && !staleOnly}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Stale {totalStale > 0 && <span className="tabular-nums">({totalStale})</span>}
            </Button>
            <Input
              placeholder="Filter by name, phone, location…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-72 bg-surface"
            />
          </div>
        </div>

        {/* Filter pills */}
        <FilterPills
          propTypes={propTypes} urgencies={urgencies} budgets={budgets}
          onPropType={(v) => togglePill(propTypes, setPropTypes, v)}
          onUrgency={(v) => togglePill(urgencies, setUrgencies, v)}
          onBudget={(v) => togglePill(budgets, setBudgets, v)}
          onClear={clearFilters}
          activeCount={activeFilterCount}
        />

        {/* Bulk actions */}
        {selected.size >= 2 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
            <div className="font-medium">{selected.size} selected</div>
            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-2" disabled={bulkBusy}>
                    <ArrowRight className="h-4 w-4" /> Move to…
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Set status</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {STATUSES.map((s) => (
                    <DropdownMenuItem key={s} onClick={() => bulkMove(s)}>{s}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm" variant="outline" className="gap-2"
                onClick={() => toast.info("Team assignment is coming soon")}
              >
                <UserPlus className="h-4 w-4" /> Assign
              </Button>
              <Button size="sm" variant="outline" className="gap-2" onClick={bulkExport}>
                <Download className="h-4 w-4" /> Export
              </Button>
              <Button size="sm" variant="ghost" className="gap-2" onClick={clearSelection}>
                <X className="h-4 w-4" /> Clear
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : isMobile ? (
          <Accordion type="multiple" defaultValue={[...STATUSES]} className="space-y-2">
            {STATUSES.map((s) => {
              const items = filtered.filter((l) => l.status === s);
              const totalK = items.reduce((sum, l) => sum + leadBudgetK(l), 0);
              return (
                <AccordionItem key={s} value={s} className="rounded-xl border border-border bg-surface px-3 [&]:border-b">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-2">
                      <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", statusClass[s])}>{s}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{items.length} · {fmtK(totalK)}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2 pb-3">
                      {items.length === 0 ? (
                        <div className="text-xs text-muted-foreground text-center py-4">No leads</div>
                      ) : items.map((l) => (
                        <LeadCard key={l.id} lead={l} onOpen={openCard}
                          selected={selected.has(l.id)} onToggleSelect={() => toggleSelect(l.id)}
                          highlight={highlightIds.has(l.id)} draggable={false} />
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        ) : (
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {STATUSES.map((s) => (
                <Column key={s} status={s}
                  leads={filtered.filter((l) => l.status === s)}
                  onOpen={openCard}
                  selected={selected}
                  onToggleSelect={toggleSelect}
                  highlightIds={highlightIds} />
              ))}
            </div>
            <DragOverlay>
              {activeLead ? <LeadCard lead={activeLead} dragging /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <LeadDetailSheet
        lead={openLead}
        open={sheetOpen}
        onOpenChange={(v) => { setSheetOpen(v); if (!v) setOpenLeadId(null); }}
        onChanged={load}
      />
    </AppShell>
  );
}

function FilterPills({
  propTypes, urgencies, budgets, onPropType, onUrgency, onBudget, onClear, activeCount,
}: {
  propTypes: Set<string>; urgencies: Set<string>; budgets: Set<string>;
  onPropType: (v: string) => void; onUrgency: (v: string) => void; onBudget: (v: string) => void;
  onClear: () => void; activeCount: number;
}) {
  const Group = ({ label, options, active, onToggle }: { label: string; options: readonly string[]; active: Set<string>; onToggle: (v: string) => void }) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground mr-1">{label}</span>
      {options.map((o) => {
        const on = active.has(o);
        return (
          <button key={o} type="button" onClick={() => onToggle(o)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              on ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-foreground/80 hover:border-foreground/40"
            )}>{o}</button>
        );
      })}
    </div>
  );
  return (
    <div className="rounded-xl border border-border bg-surface/60 p-3 flex flex-wrap items-start gap-x-5 gap-y-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Filter className="h-3.5 w-3.5" /> Filters
      </div>
      <Group label="Type" options={PROPERTY_TYPES} active={propTypes} onToggle={onPropType} />
      <Group label="Urgency" options={URGENCIES} active={urgencies} onToggle={onUrgency} />
      <Group label="Budget" options={BUDGETS} active={budgets} onToggle={onBudget} />
      {activeCount > 0 && (
        <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1 text-xs" onClick={onClear}>
          <X className="h-3 w-3" /> Clear ({activeCount})
        </Button>
      )}
    </div>
  );
}

function Column({
  status, leads, onOpen, selected, onToggleSelect, highlightIds,
}: {
  status: Status; leads: Lead[]; onOpen: (id: string) => void;
  selected: Set<string>; onToggleSelect: (id: string) => void; highlightIds: Set<string>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const staleCount = leads.filter(isStale).length;
  const totalK = leads.reduce((sum, l) => sum + leadBudgetK(l), 0);
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-xl border bg-surface p-3 min-h-[400px] flex flex-col gap-2 transition-colors",
        isOver ? "border-primary/60 bg-primary/5" : "border-border"
      )}
    >
      <div className="flex items-center justify-between px-1 py-1 sticky top-0">
        <div className="flex flex-col gap-0.5">
          <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium w-fit", statusClass[status])}>{status}</span>
          <span className="text-[10px] text-muted-foreground tabular-nums pl-1">{fmtK(totalK)} total</span>
        </div>
        <div className="flex items-center gap-1.5">
          {staleCount > 0 && (
            <span title={`${staleCount} older than ${STALE_HOURS}h`}
              className="inline-flex items-center gap-0.5 rounded-full bg-status-lost/15 text-status-lost border border-status-lost/30 px-1.5 py-0.5 text-[10px] font-medium">
              <AlertTriangle className="h-2.5 w-2.5" />{staleCount}
            </span>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">{leads.length}</span>
        </div>
      </div>
      <div className="flex-1 space-y-2">
        {leads.map((l) => (
          <LeadCard key={l.id} lead={l} onOpen={onOpen}
            selected={selected.has(l.id)} onToggleSelect={() => onToggleSelect(l.id)}
            highlight={highlightIds.has(l.id)} />
        ))}
        {leads.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-8 border border-dashed border-border/60 rounded-lg">
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

function LeadCard({
  lead, dragging = false, onOpen, selected = false, onToggleSelect, highlight = false, draggable = true,
}: {
  lead: Lead; dragging?: boolean; onOpen?: (id: string) => void;
  selected?: boolean; onToggleSelect?: () => void; highlight?: boolean; draggable?: boolean;
}) {
  const draggableHook = useDraggable({ id: lead.id, disabled: !draggable });
  const { attributes, listeners, setNodeRef, transform, isDragging } = draggableHook;
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const isVapi = lead.source?.toLowerCase().includes("vapi");
  const stale = isStale(lead);

  return (
    <div
      ref={draggable ? setNodeRef : undefined}
      style={style}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      onClick={() => onOpen?.(lead.id)}
      className={cn(
        "group rounded-lg border bg-background p-3 select-none transition-shadow",
        draggable && "cursor-grab active:cursor-grabbing",
        "hover:shadow-md hover:border-border/80",
        stale && "border-status-lost/40 ring-1 ring-status-lost/20",
        selected && "ring-2 ring-primary border-primary/60",
        highlight && "row-highlight",
        (isDragging || dragging) && "opacity-60 shadow-lg ring-1 ring-primary/30"
      )}
    >
      <div className="flex items-start gap-2">
        {onToggleSelect && (
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelect()}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Select ${lead.full_name}`}
            className="mt-0.5"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {stale && (
                <span title={`No movement in ${STALE_HOURS}h+`} className="shrink-0 h-1.5 w-1.5 rounded-full bg-status-lost" />
              )}
              <div className="font-medium text-sm truncate">{lead.full_name}</div>
            </div>
            {isVapi && (
              <span title="From Vapi call" className="shrink-0 inline-flex items-center gap-1 rounded-md bg-primary/15 text-primary px-1.5 py-0.5 text-[10px] font-medium">
                <Radio className="h-2.5 w-2.5" /> Vapi
              </span>
            )}
          </div>

          {lead.phone && (
            <a href={`tel:${lead.phone}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <Phone className="h-3 w-3" /> {lead.phone}
            </a>
          )}

          <div className="mt-2 flex flex-wrap gap-1.5">
            {lead.property_type && (
              <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-foreground/80">{lead.property_type}</span>
            )}
            {lead.budget && (
              <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-foreground/80">{lead.budget}</span>
            )}
            {lead.urgency && (
              <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px]", urgencyTone[lead.urgency] ?? "border-border bg-accent text-foreground/80")}>
                {lead.urgency}
              </span>
            )}
          </div>

          <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="h-2.5 w-2.5" />
            {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
          </div>
        </div>
      </div>
    </div>
  );
}
