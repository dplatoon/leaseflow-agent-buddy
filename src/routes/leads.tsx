import { createFileRoute } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useEffect, useState } from "react";
import AppShell from "@/components/leaseflow/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { STATUSES, statusClass, type Lead, type Status } from "@/lib/leaseflow";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, MessageSquare, Trash2, X } from "lucide-react";
import { AlertTriangle, Sheet as SheetIcon } from "lucide-react";
import LeadDetailSheet from "@/components/leaseflow/LeadDetailSheet";
import SendMessageDialog from "@/components/leaseflow/SendMessageDialog";
import RetryFailedMessagesDialog from "@/components/leaseflow/RetryFailedMessagesDialog";
import ExportFailuresButton from "@/components/leaseflow/ExportFailuresButton";
import { RefreshCw } from "lucide-react";
import { handleStatusChange } from "@/lib/reminders";
import { useReminderRules } from "@/hooks/useReminderRules";
import { syncNewLeadsToSheets } from "@/server/sheets-sync.functions";

const PAGE_SIZES = [10, 25, 50, 100] as const;

const leadsSearchSchema = z.object({
  page: fallback(z.number().int().min(1), 1).default(1),
  pageSize: fallback(z.number().int().refine((n) => (PAGE_SIZES as readonly number[]).includes(n)), 25).default(25),
  status: fallback(z.string(), "all").default("all"),
  q: fallback(z.string(), "").default(""),
});

type LeadsSearch = z.infer<typeof leadsSearchSchema>;

export const Route = createFileRoute("/leads")({
  head: () => ({ meta: [{ title: "Leads — LeaseFlow" }] }),
  validateSearch: zodValidator(leadsSearchSchema),
  component: LeadsPage,
});

function LeadsPage() {
  const { user } = useAuth();
  const { rules } = useReminderRules();
  const navigate = Route.useNavigate();
  const { page, pageSize, status: statusFilter, q: search } = Route.useSearch();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(search);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [bulkSendOpen, setBulkSendOpen] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const [failedLeadIds, setFailedLeadIds] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);

  // Reset selection when the visible page changes
  useEffect(() => { setSelected(new Set()); }, [page, pageSize, statusFilter, search]);

  // Keep local input in sync with URL (e.g. back/forward navigation)
  useEffect(() => { setSearchInput(search); }, [search]);

  // Debounce search input → URL
  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => {
      navigate({ search: (prev: LeadsSearch) => ({ ...prev, q: searchInput, page: 1 }) });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let query = supabase
      .from("leads")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    const q = search.trim();
    if (q) query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`);

    const { data, count, error } = await query;
    if (error) toast.error(error.message);
    setLeads((data ?? []) as Lead[]);
    setTotal(count ?? 0);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user, page, pageSize, statusFilter, search]);

  useEffect(() => {
    const onCreated = () => load();
    window.addEventListener("leaseflow:lead-created", onCreated);
    window.addEventListener("leaseflow:calls-changed", onCreated);
    return () => {
      window.removeEventListener("leaseflow:lead-created", onCreated);
      window.removeEventListener("leaseflow:calls-changed", onCreated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, page, pageSize, statusFilter, search]);

  // Compute "has unresolved message failure" per visible lead: latest message
  // log for that lead is `message_failed` (no successful send afterwards).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user || leads.length === 0) {
        setFailedLeadIds(new Set());
        return;
      }
      const ids = leads.map((l) => l.id);
      const { data } = await supabase
        .from("call_logs" as never)
        .select("lead_id, outcome, created_at")
        .in("lead_id", ids)
        .in("outcome", ["message_failed", "message_sent"])
        .order("created_at", { ascending: false });
      if (cancelled) return;
      const latest = new Map<string, string>();
      for (const row of (data ?? []) as { lead_id: string; outcome: string }[]) {
        if (!latest.has(row.lead_id)) latest.set(row.lead_id, row.outcome);
      }
      const failed = new Set<string>();
      for (const [leadId, outcome] of latest) {
        if (outcome === "message_failed") failed.add(leadId);
      }
      setFailedLeadIds(failed);
    })();
    return () => { cancelled = true; };
  }, [user, leads]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleSyncToSheets = async () => {
    setSyncing(true);
    const t = toast.loading("Syncing new leads to Google Sheets…");
    try {
      const res = await syncNewLeadsToSheets();
      toast.dismiss(t);
      if (res.total === 0) {
        toast.info("No new leads from the last 24 hours to sync");
      } else if (res.failures.length === 0) {
        toast.success(`Synced ${res.synced} of ${res.total} lead${res.total === 1 ? "" : "s"} to Sheets`);
      } else {
        toast.warning(`Synced ${res.synced} of ${res.total} — ${res.failures.length} failed`);
      }
      load();
    } catch (e) {
      toast.dismiss(t);
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const rangeFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeTo = Math.min(page * pageSize, total);

  const updateStatus = async (id: string, status: Status) => {
    const prev = leads;
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status } : l)));
    const { error } = await supabase.from("leads").update({ status }).eq("id", id);
    if (error) {
      setLeads(prev);
      toast.error(error.message);
    } else {
      toast.success("Status updated");
      if (user && rules) {
        try { await handleStatusChange({ userId: user.id, leadId: id, newStatus: status, rules }); } catch {}
      }
    }
  };

  const selectedIds = Array.from(selected);
  const allSelected = leads.length > 0 && leads.every((l) => selected.has(l.id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(leads.map((l) => l.id)) : new Set());
  };
  const toggleOne = (id: string, checked: boolean) => {
    setSelected((s) => {
      const next = new Set(s);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const bulkUpdateStatus = async (status: Status) => {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    const { error } = await supabase.from("leads").update({ status }).in("id", selectedIds);
    setBulkBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Updated ${selectedIds.length} lead${selectedIds.length === 1 ? "" : "s"} to ${status}`);
    if (user && rules) {
      await Promise.all(
        selectedIds.map((id) =>
          handleStatusChange({ userId: user.id, leadId: id, newStatus: status, rules }).catch(() => {})
        )
      );
    }
    setSelected(new Set());
    load();
  };

  const bulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    const { error } = await supabase.from("leads").delete().in("id", selectedIds);
    setBulkBusy(false);
    setConfirmDelete(false);
    if (error) return toast.error(error.message);
    toast.success(`Deleted ${selectedIds.length} lead${selectedIds.length === 1 ? "" : "s"}`);
    setSelected(new Set());
    load();
  };

  return (
    <AppShell showSearch searchValue={searchInput} onSearchChange={setSearchInput}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
            <p className="text-sm text-muted-foreground">
              {total === 0 ? "No leads" : `Showing ${rangeFrom}–${rangeTo} of ${total}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncToSheets}
              disabled={syncing}
              className="gap-2"
              title="Push new leads from the last 24h to your Google Sheets webhook"
            >
              <SheetIcon className="h-4 w-4" />
              {syncing ? "Syncing…" : "Sync to Sheets"}
            </Button>
            <ExportFailuresButton
              leadIds={leads.map((l) => l.id)}
              label="Export failures"
              title="Download failed messages for the leads on this page (with optional date range)"
            />
            <Select
              value={statusFilter}
              onValueChange={(v) => navigate({ search: (prev: LeadsSearch) => ({ ...prev, status: v, page: 1 }) })}
            >
              <SelectTrigger className="w-40 bg-surface"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => navigate({ search: (prev: LeadsSearch) => ({ ...prev, pageSize: Number(v), page: 1 }) })}
            >
              <SelectTrigger className="w-28 bg-surface"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-accent/30 px-4 py-3 text-sm">
            <div className="font-medium">
              {selected.size} selected
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={bulkBusy}
                onClick={() => setBulkSendOpen(true)}
                className="gap-2"
              >
                <MessageSquare className="h-4 w-4" /> Send message
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={bulkBusy}
                onClick={() => setRetryOpen(true)}
                className="gap-2"
                title="Re-send the last failed message for each selected lead"
              >
                <RefreshCw className="h-4 w-4" /> Retry failed
              </Button>
              <Select onValueChange={(v) => bulkUpdateStatus(v as Status)}>
                <SelectTrigger className="w-44 bg-surface" disabled={bulkBusy}>
                  <SelectValue placeholder="Set status…" />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                variant="destructive"
                size="sm"
                disabled={bulkBusy}
                onClick={() => setConfirmDelete(true)}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={bulkBusy}
                onClick={() => setSelected(new Set())}
                className="gap-2"
              >
                <X className="h-4 w-4" /> Clear
              </Button>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={(v) => toggleAll(v === true)}
                      aria-label="Select all on page"
                    />
                  </th>
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
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                ) : leads.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No leads found.</td></tr>
                ) : leads.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => { setOpenLeadId(l.id); setSheetOpen(true); }}
                    className={cn("hover:bg-accent/30 cursor-pointer", selected.has(l.id) && "bg-accent/30")}
                  >
                    <td className="px-4 py-3">
                      <Checkbox
                        checked={selected.has(l.id)}
                        onCheckedChange={(v) => toggleOne(l.id, v === true)}
                        aria-label={`Select ${l.full_name}`}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {l.full_name}
                        {failedLeadIds.has(l.id) && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-destructive/15 text-destructive border border-destructive/30 px-1.5 py-0.5 text-[10px] font-medium"
                            title="Last message attempt failed"
                          >
                            <AlertTriangle className="h-2.5 w-2.5" />
                            Failed msg
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{l.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{l.location ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{l.budget ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{l.property_type ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{l.source}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
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

          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
            <div className="text-muted-foreground">
              Page {page} of {totalPages}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => navigate({ search: (prev: LeadsSearch) => ({ ...prev, page: Math.max(1, page - 1) }) })}
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => navigate({ search: (prev: LeadsSearch) => ({ ...prev, page: page + 1 }) })}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} lead{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected leads. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkBusy}
              onClick={(e) => { e.preventDefault(); bulkDelete(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LeadDetailSheet
        lead={openLeadId ? leads.find((l) => l.id === openLeadId) ?? null : null}
        open={sheetOpen}
        onOpenChange={(v) => { setSheetOpen(v); if (!v) setOpenLeadId(null); }}
        onChanged={load}
      />

      <SendMessageDialog
        leads={leads.filter((l) => selected.has(l.id))}
        open={bulkSendOpen}
        onOpenChange={setBulkSendOpen}
        agentName={user?.user_metadata?.full_name ?? null}
      />

      <RetryFailedMessagesDialog
        leads={leads.filter((l) => selected.has(l.id))}
        open={retryOpen}
        onOpenChange={setRetryOpen}
        onDone={load}
      />
    </AppShell>
  );
}
