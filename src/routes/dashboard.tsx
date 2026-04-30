import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import AppShell from "@/components/leaseflow/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { statusClass, type Lead, type Status } from "@/lib/leaseflow";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Users, Sparkles, Calendar, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — LeaseFlow" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
    setLeads((data ?? []) as Lead[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const today = new Date(); today.setHours(0,0,0,0);
  const total = leads.length;
  const newToday = leads.filter((l) => new Date(l.created_at) >= today).length;
  const scheduled = leads.filter((l) => l.status === "Scheduled").length;
  const closed = leads.filter((l) => l.status === "Closed").length;

  const kpis = [
    { label: "Total Leads", value: total, icon: Users, tint: "text-primary" },
    { label: "New Today", value: newToday, icon: Sparkles, tint: "text-status-new" },
    { label: "Scheduled", value: scheduled, icon: Calendar, tint: "text-status-scheduled" },
    { label: "Closed", value: closed, icon: CheckCircle2, tint: "text-status-closed" },
  ];

  return (
    <AppShell gated>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview of your rental pipeline.</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{k.label}</span>
                <k.icon className={cn("h-4 w-4", k.tint)} />
              </div>
              <div className="mt-2 text-3xl font-semibold tracking-tight">{k.value}</div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-border bg-surface">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="font-medium">Recent activity</h2>
          </div>
          <div className="divide-y divide-border">
            {loading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading…</div>
            ) : leads.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No leads yet. Click + New Lead to get started.</div>
            ) : (
              leads.slice(0, 10).map((l) => (
                <div key={l.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{l.full_name}</div>
                    <div className="text-xs text-muted-foreground truncate">{l.location ?? "—"} · {l.source}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={cn("rounded-full border px-2 py-0.5 text-xs", statusClass[l.status as Status] ?? "")}>{l.status}</span>
                    <span className="text-xs text-muted-foreground hidden sm:inline">{formatDistanceToNow(new Date(l.created_at), { addSuffix: true })}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
