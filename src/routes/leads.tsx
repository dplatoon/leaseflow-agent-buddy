import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/leaseflow/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { STATUSES, statusClass, type Lead, type Status } from "@/lib/leaseflow";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/leads")({
  head: () => ({ meta: [{ title: "Leads — LeaseFlow" }] }),
  component: LeadsPage,
});

function LeadsPage() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
    setLeads((data ?? []) as Lead[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (!q) return true;
      return l.full_name.toLowerCase().includes(q) || (l.phone ?? "").toLowerCase().includes(q);
    });
  }, [leads, search, statusFilter]);

  const updateStatus = async (id: string, status: Status) => {
    const prev = leads;
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status } : l)));
    const { error } = await supabase.from("leads").update({ status }).eq("id", id);
    if (error) {
      setLeads(prev);
      toast.error(error.message);
    } else {
      toast.success("Status updated");
    }
  };

  return (
    <AppShell gated showSearch searchValue={search} onSearchChange={setSearch}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
            <p className="text-sm text-muted-foreground">{filtered.length} of {leads.length} leads</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40 bg-surface"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Phone</th>
                  <th className="text-left px-4 py-3 font-medium">Location</th>
                  <th className="text-left px-4 py-3 font-medium">Budget</th>
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-left px-4 py-3 font-medium">Source</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No leads found.</td></tr>
                ) : filtered.map((l) => (
                  <tr key={l.id} className="hover:bg-accent/30">
                    <td className="px-4 py-3 font-medium">{l.full_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{l.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{l.location ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{l.budget ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{l.property_type ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{l.source}</td>
                    <td className="px-4 py-3">
                      <Select value={l.status} onValueChange={(v) => updateStatus(l.id, v as Status)}>
                        <SelectTrigger className={cn("h-7 w-[120px] rounded-full border px-2 py-0.5 text-xs", statusClass[l.status as Status] ?? "")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{format(new Date(l.created_at), "MMM d")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
