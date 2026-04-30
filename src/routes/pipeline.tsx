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
import { Phone, MapPin, Clock, Radio } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";

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

function PipelinePage() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
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
    if (!q) return leads;
    return leads.filter((l) =>
      [l.full_name, l.phone, l.location, l.budget].some((v) => v?.toLowerCase().includes(q))
    );
  }, [leads, search]);

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
            <p className="text-sm text-muted-foreground">Drag a lead to update its status. {filtered.length} of {leads.length} shown.</p>
          </div>
          <Input
            placeholder="Filter by name, phone, location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-72 bg-surface"
          />
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {STATUSES.map((s) => (
                <Column key={s} status={s} leads={filtered.filter((l) => l.status === s)} />
              ))}
            </div>
            <DragOverlay>
              {activeLead ? <LeadCard lead={activeLead} dragging /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </AppShell>
  );
}

function Column({ status, leads }: { status: Status; leads: Lead[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
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
        <span className="text-xs text-muted-foreground tabular-nums">{leads.length}</span>
      </div>
      <div className="flex-1 space-y-2">
        {leads.map((l) => <LeadCard key={l.id} lead={l} />)}
        {leads.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-8 border border-dashed border-border/60 rounded-lg">
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

function LeadCard({ lead, dragging = false }: { lead: Lead; dragging?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const isVapi = lead.source?.toLowerCase().includes("vapi");

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "group rounded-lg border bg-background p-3 cursor-grab active:cursor-grabbing select-none transition-shadow",
        "hover:shadow-md hover:border-border/80",
        (isDragging || dragging) && "opacity-60 shadow-lg ring-1 ring-primary/30"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm truncate">{lead.full_name}</div>
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
