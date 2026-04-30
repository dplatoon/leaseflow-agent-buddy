import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import AppShell from "@/components/leaseflow/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { STATUSES, statusClass, type Lead, type Status } from "@/lib/leaseflow";
import { DndContext, useDraggable, useDroppable, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/pipeline")({
  head: () => ({ meta: [{ title: "Pipeline — LeaseFlow" }] }),
  component: PipelinePage,
});

function PipelinePage() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
    setLeads((data ?? []) as Lead[]);
  };
  useEffect(() => { load(); }, [user]);

  const onDragEnd = async (e: DragEndEvent) => {
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

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
          <p className="text-sm text-muted-foreground">Drag a lead to update its status.</p>
        </div>
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {STATUSES.map((s) => (
              <Column key={s} status={s} leads={leads.filter((l) => l.status === s)} />
            ))}
          </div>
        </DndContext>
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
        "rounded-xl border bg-surface p-3 min-h-[300px] flex flex-col gap-2 transition-colors",
        isOver ? "border-primary/60 bg-primary/5" : "border-border"
      )}
    >
      <div className="flex items-center justify-between px-1 py-1">
        <span className={cn("rounded-full border px-2 py-0.5 text-xs", statusClass[status])}>{status}</span>
        <span className="text-xs text-muted-foreground">{leads.length}</span>
      </div>
      <div className="flex-1 space-y-2">
        {leads.map((l) => <Card key={l.id} lead={l} />)}
        {leads.length === 0 && <div className="text-xs text-muted-foreground text-center py-6">No leads</div>}
      </div>
    </div>
  );
}

function Card({ lead }: { lead: Lead }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "rounded-lg border border-border bg-background p-3 cursor-grab active:cursor-grabbing select-none",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <div className="font-medium text-sm">{lead.full_name}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{lead.location ?? "—"}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {lead.budget && <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">{lead.budget}</span>}
        {lead.urgency && <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">{lead.urgency}</span>}
      </div>
    </div>
  );
}
