import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import AppShell from "@/components/leaseflow/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { statusClass, type Lead, type Status } from "@/lib/leaseflow";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Users, Sparkles, Calendar, CheckCircle2, Phone, PhoneCall } from "lucide-react";
import { CALL_OUTCOMES, OUTCOME_LABELS, OUTCOME_TONE, type CallLog, type CallOutcome } from "@/lib/calls";
import CallTrendSparkline from "@/components/leaseflow/CallTrendSparkline";
import { format } from "date-fns";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — LeaseFlow" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    // Calls in the last 7 days are enough to compute today + this-week buckets.
    const weekAgoIso = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const [{ data: leadRows }, { data: callRows }] = await Promise.all([
      supabase.from("leads").select("*").order("created_at", { ascending: false }),
      supabase
        .from("call_logs" as never)
        .select("*")
        .gte("created_at", weekAgoIso)
        .order("created_at", { ascending: false }),
    ]);
    setLeads((leadRows ?? []) as Lead[]);
    setCalls((callRows ?? []) as unknown as CallLog[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  useEffect(() => {
    const onCreated = () => load();
    window.addEventListener("leaseflow:lead-created", onCreated);
    window.addEventListener("leaseflow:calls-changed", onCreated);
    return () => {
      window.removeEventListener("leaseflow:lead-created", onCreated);
      window.removeEventListener("leaseflow:calls-changed", onCreated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const today = new Date(); today.setHours(0,0,0,0);
  const total = leads.length;
  const newToday = leads.filter((l) => new Date(l.created_at) >= today).length;
  const scheduled = leads.filter((l) => l.status === "Scheduled").length;
  const closed = leads.filter((l) => l.status === "Closed").length;

  // Call metrics
  const callsToday = calls.filter((c) => new Date(c.created_at) >= today);
  const callsWeek = calls; // already limited to last 7 days
  const outcomeCounts = CALL_OUTCOMES.reduce<Record<CallOutcome, number>>((acc, o) => {
    acc[o] = callsWeek.filter((c) => c.outcome === o).length;
    return acc;
  }, {} as Record<CallOutcome, number>);
  const totalWeekCalls = callsWeek.length;
  const connectedToday = callsToday.filter((c) =>
    ["interested", "scheduled_viewing", "callback_requested", "not_qualified"].includes(c.outcome)
  ).length;

  // Build last-7-days buckets (oldest → newest, including today).
  const dayBuckets = (() => {
    const days: { date: Date; key: string; label: string; total: number; perOutcome: Record<CallOutcome, number> }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({
        date: d,
        key,
        label: format(d, "EEE M/d"),
        total: 0,
        perOutcome: CALL_OUTCOMES.reduce((acc, o) => ({ ...acc, [o]: 0 }), {} as Record<CallOutcome, number>),
      });
    }
    const byKey = new Map(days.map((d) => [d.key, d]));
    for (const c of callsWeek) {
      const k = new Date(c.created_at).toISOString().slice(0, 10);
      const day = byKey.get(k);
      if (!day) continue;
      day.total += 1;
      day.perOutcome[c.outcome] += 1;
    }
    return days;
  })();
  const totalSeries = dayBuckets.map((d) => d.total);
  const dayLabels = dayBuckets.map((d) => d.label);
  const peakDay = dayBuckets.reduce((m, d) => (d.total > m.total ? d : m), dayBuckets[0]);

  const kpis = [
    { label: "Total Leads", value: total, icon: Users, tint: "text-primary" },
    { label: "New Today", value: newToday, icon: Sparkles, tint: "text-status-new" },
    { label: "Calls Today", value: callsToday.length, icon: Phone, tint: "text-status-contacted", sub: `${connectedToday} connected` },
    { label: "Calls This Week", value: totalWeekCalls, icon: PhoneCall, tint: "text-primary", sub: "Last 7 days" },
    { label: "Scheduled", value: scheduled, icon: Calendar, tint: "text-status-scheduled" },
    { label: "Closed", value: closed, icon: CheckCircle2, tint: "text-status-closed" },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview of your rental pipeline.</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{k.label}</span>
                <k.icon className={cn("h-4 w-4", k.tint)} />
              </div>
              <div className="mt-2 text-3xl font-semibold tracking-tight">{k.value}</div>
              {"sub" in k && k.sub && (
                <div className="mt-1 text-[11px] text-muted-foreground">{k.sub}</div>
              )}
            </div>
          ))}
        </div>

        {/* 7-day trend */}
        <div className="rounded-xl border border-border bg-surface">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">Calls trend — last 7 days</h2>
              <p className="text-xs text-muted-foreground">Daily totals plus per-outcome breakdown.</p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs text-muted-foreground">Peak day</div>
              <div className="text-sm font-medium tabular-nums">{peakDay.total} <span className="text-muted-foreground font-normal">· {peakDay.label}</span></div>
            </div>
          </div>
          {totalWeekCalls === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No calls in the last 7 days yet.
            </div>
          ) : (
            <div className="p-5 space-y-4">
              {/* Total trend */}
              <div className="flex items-center gap-4">
                <div className="min-w-[140px]">
                  <div className="text-xs text-muted-foreground">All calls</div>
                  <div className="text-2xl font-semibold tabular-nums">{totalWeekCalls}</div>
                </div>
                <div className="flex-1 overflow-hidden">
                  <CallTrendSparkline values={totalSeries} labels={dayLabels} width={320} height={48} />
                </div>
              </div>

              {/* Per-day axis labels */}
              <div className="grid grid-cols-7 gap-1 text-[10px] text-muted-foreground tabular-nums">
                {dayBuckets.map((d) => (
                  <div key={d.key} className="text-center">
                    <div>{format(d.date, "EEE")}</div>
                    <div className="text-foreground font-medium">{d.total}</div>
                  </div>
                ))}
              </div>

              {/* Per-outcome sparklines */}
              <div className="border-t border-border pt-4 space-y-2">
                {CALL_OUTCOMES
                  .map((o) => ({
                    outcome: o,
                    series: dayBuckets.map((d) => d.perOutcome[o]),
                    total: outcomeCounts[o],
                  }))
                  .filter((row) => row.total > 0)
                  .sort((a, b) => b.total - a.total)
                  .map(({ outcome, series, total }) => (
                    <div key={outcome} className="flex items-center gap-3">
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium shrink-0 min-w-[140px] text-center", OUTCOME_TONE[outcome])}>
                        {OUTCOME_LABELS[outcome]}
                      </span>
                      <div className="flex-1 overflow-hidden">
                        <CallTrendSparkline values={series} labels={dayLabels} width={260} height={28} />
                      </div>
                      <span className="text-xs tabular-nums w-10 text-right text-muted-foreground">{total}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Outcome breakdown */}
        <div className="rounded-xl border border-border bg-surface">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 className="font-medium">Call outcomes — last 7 days</h2>
            <span className="text-xs text-muted-foreground tabular-nums">{totalWeekCalls} total</span>
          </div>
          {totalWeekCalls === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No calls logged yet. Open any lead and use <span className="text-foreground">Log a call</span> to start tracking.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {CALL_OUTCOMES
                .map((o) => ({ outcome: o, count: outcomeCounts[o] }))
                .filter((row) => row.count > 0)
                .sort((a, b) => b.count - a.count)
                .map(({ outcome, count }) => {
                  const pct = totalWeekCalls > 0 ? Math.round((count / totalWeekCalls) * 100) : 0;
                  return (
                    <li key={outcome} className="px-5 py-3 flex items-center gap-3">
                      <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium shrink-0 min-w-[140px]", OUTCOME_TONE[outcome])}>
                        {OUTCOME_LABELS[outcome]}
                      </span>
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary/70 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-sm tabular-nums w-16 text-right">
                        {count} <span className="text-muted-foreground text-xs">({pct}%)</span>
                      </span>
                    </li>
                  );
                })}
            </ul>
          )}
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
