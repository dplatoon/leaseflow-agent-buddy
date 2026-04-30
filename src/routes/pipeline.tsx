import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/leaseflow/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { STATUSES, statusClass, type Lead, type Status } from "@/lib/leaseflow";
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
import { Phone, MapPin, Clock, Radio, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import LeadDetailSheet from "@/components/leaseflow/LeadDetailSheet";
import { Button } from "@/components/ui/button";

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

// A lead is "stale" if it's been sitting in an early-funnel column for more
// than 24h with no movement. Closed/Lost are terminal — they're never stale.
const STALE_HOURS = 24;
const STALE_STATUSES = new Set<Status>(["New", "Contacted"]);
function isStale(lead: Lead) {
  if (!STALE_STATUSES.has(lead.status as Status)) return false;
  const ageMs = Date.now() - new Date(lead.created_at).getTime();
  return ageMs > STALE_HOURS * 60 * 60 * 1000;
}

function PipelinePage() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [staleOnly, setStaleOnly] = useState(false);
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
    setLeads((data ?? []) as Lead[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [user]);

  useEffect(() => {
    const onCreated = () => load();
    window.addEventListener("leaseflow:lead-created", onCreated);
    return () => window.removeEventListener("leaseflow:lead-created", onCreated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = leads;
    if (q) {
      out = out.filter((l) =>
        [l.full_name, l.phone, l.location, l.budget].some((v) => v?.toLowerCase().includes(q))
      );
    }
    if (staleOnly) out = out.filter(isStale);
    return out;
  }, [leads, search, staleOnly]);

  const totalStale = useMemo(() => leads.filter(isStale).length, [leads]);
  const openLead = openLeadId ? leads.find((l) => l.id === openLeadId) ?? null : null;

  const openCard = (id: string) => {
    setOpenLeadId(id);
    setSheetOpen(true);
  };

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
    if (error) {
      setLeads(prev);
      toast.error(error.message);
    } else {
      toast.success(`Moved to ${newStatus}`);
    }
  };

  const activeLead = activeId ? filtered.find((l) => l.id === activeId) : null;

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
            <p className="text-sm text-muted-foreground">
              Drag to change status, click a card to view details. {filtered.length} of {leads.length} shown
              {totalStale > 0 && (
                <> · <span className="text-status-lost font-medium">{totalStale} stale</span></>
              )}.
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
              title={`Show only leads in New/Contacted older than ${STALE_HOURS}h`}
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

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {STATUSES.map((s) => (
                <Column
                  key={s}
                  status={s}
                  leads={filtered.filter((l) => l.status === s)}
                  onOpen={openCard}
                />
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

function Column({ status, leads, onOpen }: { status: Status; leads: Lead[]; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const staleCount = leads.filter(isStale).length;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-xl border bg-surface p-3 min-h-[400px] flex flex-col gap-2 transition-colors",
        isOver ? "border-primary/60 bg-primary/5" : "border-border"
      )}
    >
      <div className="flex items-center justify-between px-1 py-1 sticky top-0">
        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", statusClass[status])}>{status}</span>
        <div className="flex items-center gap-1.5">
          {staleCount > 0 && (
            <span
              title={`${staleCount} lead${staleCount === 1 ? "" : "s"} older than ${STALE_HOURS}h`}
              className="inline-flex items-center gap-0.5 rounded-full bg-status-lost/15 text-status-lost border border-status-lost/30 px-1.5 py-0.5 text-[10px] font-medium"
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              {staleCount}
            </span>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">{leads.length}</span>
        </div>
      </div>
      <div className="flex-1 space-y-2">
        {leads.map((l) => <LeadCard key={l.id} lead={l} onOpen={onOpen} />)}
        {leads.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-8 border border-dashed border-border/60 rounded-lg">
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

function LeadCard({ lead, dragging = false, onOpen }: { lead: Lead; dragging?: boolean; onOpen?: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const isVapi = lead.source?.toLowerCase().includes("vapi");
  const stale = isStale(lead);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => onOpen?.(lead.id)}
      className={cn(
        "group rounded-lg border bg-background p-3 cursor-grab active:cursor-grabbing select-none transition-shadow",
        "hover:shadow-md hover:border-border/80",
        stale && "border-status-lost/40 ring-1 ring-status-lost/20",
        (isDragging || dragging) && "opacity-60 shadow-lg ring-1 ring-primary/30"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {stale && (
            <span title={`No movement in ${STALE_HOURS}h+`} className="shrink-0 h-1.5 w-1.5 rounded-full bg-status-lost" aria-label="Stale" />
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
        <a
          href={`tel:${lead.phone}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <Phone className="h-3 w-3" /> {lead.phone}
        </a>
      )}

      {lead.location && (
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground truncate">
          <MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{lead.location}</span>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {lead.budget && (
          <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-foreground/80">{lead.budget}</span>
        )}
        {lead.property_type && (
          <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-foreground/80">{lead.property_type}</span>
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
  );
}
