import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import AppShell from "@/components/leaseflow/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { statusClass, type Lead, type Status } from "@/lib/leaseflow";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Users, Sparkles, Calendar, CheckCircle2, Phone, PhoneCall, MessageSquare, AlertTriangle } from "lucide-react";
import { CALL_OUTCOMES, OUTCOME_LABELS, OUTCOME_TONE, type CallLog, type CallOutcome } from "@/lib/calls";
import CallTrendSparkline from "@/components/leaseflow/CallTrendSparkline";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Filter } from "lucide-react";
import { parseFailureReason } from "@/lib/templates";
import ExportFailuresButton from "@/components/leaseflow/ExportFailuresButton";

const TREND_FILTER_KEY = "leaseflow:dashboard:trend-outcome-filter";

function loadTrendFilter(): CallOutcome[] {
  if (typeof window === "undefined") return [...CALL_OUTCOMES];
  try {
    const raw = localStorage.getItem(TREND_FILTER_KEY);
    if (!raw) return [...CALL_OUTCOMES];
    const parsed = JSON.parse(raw) as string[];
    const valid = parsed.filter((o): o is CallOutcome => (CALL_OUTCOMES as readonly string[]).includes(o));
    return valid.length > 0 ? valid : [...CALL_OUTCOMES];
  } catch {
    return [...CALL_OUTCOMES];
  }
}

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — LeaseFlow" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [trendFilter, setTrendFilter] = useState<Set<CallOutcome>>(() => new Set(loadTrendFilter()));

  // Persist filter
  useEffect(() => {
    try {
      localStorage.setItem(TREND_FILTER_KEY, JSON.stringify([...trendFilter]));
    } catch { /* ignore */ }
  }, [trendFilter]);

  const toggleOutcome = (o: CallOutcome) => {
    setTrendFilter((prev) => {
      const next = new Set(prev);
      if (next.has(o)) next.delete(o); else next.add(o);
      return next;
    });
  };
  const setAllOutcomes = () => setTrendFilter(new Set(CALL_OUTCOMES));
  const clearOutcomes = () => setTrendFilter(new Set());
  const isFilterActive = trendFilter.size > 0 && trendFilter.size < CALL_OUTCOMES.length;

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

  // Message delivery metrics
  const msgSentToday = callsToday.filter((c) => c.outcome === "message_sent").length;
  const msgFailedToday = callsToday.filter((c) => c.outcome === "message_failed").length;
  const msgSentWeek = callsWeek.filter((c) => c.outcome === "message_sent").length;
  const msgFailedWeek = callsWeek.filter((c) => c.outcome === "message_failed").length;
  const totalMsgWeek = msgSentWeek + msgFailedWeek;
  const successRate = totalMsgWeek > 0 ? Math.round((msgSentWeek / totalMsgWeek) * 100) : null;

  // Failure reasons grouped (last 7 days)
  const failureReasonCounts = (() => {
    const map = new Map<string, number>();
    for (const c of callsWeek) {
      if (c.outcome !== "message_failed") continue;
      const r = parseFailureReason(c.notes);
      map.set(r, (map.get(r) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  })();

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

  // Filtered series (sum of selected outcomes per day)
  const filteredDaySeries = dayBuckets.map((d) =>
    [...trendFilter].reduce((sum, o) => sum + d.perOutcome[o], 0)
  );
  const filteredTotal = filteredDaySeries.reduce((a, b) => a + b, 0);
  const filteredPeak = dayBuckets.reduce(
    (m, d, i) => (filteredDaySeries[i] > m.count ? { count: filteredDaySeries[i], label: d.label } : m),
    { count: 0, label: "—" }
  );

  const kpis = [
    { label: "Total Leads", value: total, icon: Users, tint: "text-primary" },
    { label: "New Today", value: newToday, icon: Sparkles, tint: "text-status-new" },
    { label: "Calls Today", value: callsToday.length, icon: Phone, tint: "text-status-contacted", sub: `${connectedToday} connected` },
    { label: "Calls This Week", value: totalWeekCalls, icon: PhoneCall, tint: "text-primary", sub: "Last 7 days" },
    {
      label: "Messages Today",
      value: msgSentToday,
      icon: MessageSquare,
      tint: "text-primary",
      sub: msgFailedToday > 0 ? `${msgFailedToday} failed` : "All sent",
    },
    {
      label: "Messages This Week",
      value: msgSentWeek,
      icon: MessageSquare,
      tint: "text-primary",
      sub:
        totalMsgWeek === 0
          ? "No messages yet"
          : `${msgFailedWeek} failed · ${successRate}% success`,
    },
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

        {/* Message delivery breakdown */}
        {(totalMsgWeek > 0 || msgFailedWeek > 0) && (
          <div className="rounded-xl border border-border bg-surface">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="font-medium flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-primary" /> Message delivery — last 7 days
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {msgSentWeek} sent · {msgFailedWeek} failed
                  {successRate !== null && ` · ${successRate}% success`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {msgFailedWeek > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 text-destructive border border-destructive/30 px-2 py-0.5 text-xs font-medium">
                    <AlertTriangle className="h-3 w-3" /> {msgFailedWeek} failed
                  </span>
                )}
                <ExportFailuresButton
                  label="Export failures CSV"
                  title="Download failed message attempts as CSV — pick a date range"
                />
              </div>
            </div>

            {/* Sent vs failed bar */}
            <div className="px-5 py-4 space-y-3">
              <div className="h-3 rounded-full bg-muted overflow-hidden flex">
                <div
                  className="h-full bg-primary/80"
                  style={{ width: `${(msgSentWeek / totalMsgWeek) * 100}%` }}
                  title={`${msgSentWeek} sent`}
                />
                <div
                  className="h-full bg-destructive/70"
                  style={{ width: `${(msgFailedWeek / totalMsgWeek) * 100}%` }}
                  title={`${msgFailedWeek} failed`}
                />
              </div>
              <div className="flex items-center gap-4 text-[11px]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-primary/80" /> Sent <span className="text-muted-foreground tabular-nums">{msgSentWeek}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-destructive/70" /> Failed <span className="text-muted-foreground tabular-nums">{msgFailedWeek}</span>
                </span>
              </div>

              {failureReasonCounts.length > 0 && (
                <div className="border-t border-border pt-3 space-y-1.5">
                  <div className="text-[11px] text-muted-foreground">Failure reasons</div>
                  <ul className="space-y-1">
                    {failureReasonCounts.map(([reason, count]) => {
                      const pct = Math.round((count / msgFailedWeek) * 100);
                      return (
                        <li key={reason} className="flex items-center gap-3 text-xs">
                          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive border border-destructive/30 px-2 py-0.5 font-medium shrink-0 min-w-[180px]">
                            <AlertTriangle className="h-2.5 w-2.5" /> {reason}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-destructive/60 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="tabular-nums w-16 text-right text-muted-foreground">
                            {count} <span className="text-[10px]">({pct}%)</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 7-day trend */}
        <div className="rounded-xl border border-border bg-surface">
          <div className="px-5 py-4 border-b border-border space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-medium">Calls trend — last 7 days</h2>
                <p className="text-xs text-muted-foreground">
                  {isFilterActive
                    ? `Filtered to ${trendFilter.size} of ${CALL_OUTCOMES.length} outcomes.`
                    : "Daily totals plus per-outcome breakdown."}
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-muted-foreground">Peak day</div>
                <div className="text-sm font-medium tabular-nums">
                  {(isFilterActive ? filteredPeak.count : peakDay.total)} <span className="text-muted-foreground font-normal">· {isFilterActive ? filteredPeak.label : peakDay.label}</span>
                </div>
              </div>
            </div>

            {/* Outcome filter chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground mr-1">Show:</span>
              {CALL_OUTCOMES.map((o) => {
                const active = trendFilter.has(o);
                const total = outcomeCounts[o];
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() => toggleOutcome(o)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                      active ? OUTCOME_TONE[o] : "border-border text-muted-foreground/70 bg-transparent hover:text-foreground hover:border-foreground/30",
                    )}
                    aria-pressed={active}
                  >
                    {OUTCOME_LABELS[o]}
                    <span className="tabular-nums opacity-70">{total}</span>
                  </button>
                );
              })}
              <span className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2" onClick={setAllOutcomes} disabled={trendFilter.size === CALL_OUTCOMES.length}>
                  All
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2" onClick={clearOutcomes} disabled={trendFilter.size === 0}>
                  None
                </Button>
              </span>
            </div>
          </div>
          {totalWeekCalls === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No calls in the last 7 days yet.
            </div>
          ) : trendFilter.size === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No outcomes selected. Use the chips above to pick which outcomes to chart.
            </div>
          ) : (
            <div className="p-5 space-y-4">
              {/* Total trend */}
              <div className="flex items-center gap-4">
                <div className="min-w-[140px]">
                  <div className="text-xs text-muted-foreground">{isFilterActive ? "Selected calls" : "All calls"}</div>
                  <div className="text-2xl font-semibold tabular-nums">{isFilterActive ? filteredTotal : totalWeekCalls}</div>
                  {isFilterActive && (
                    <div className="text-[10px] text-muted-foreground">of {totalWeekCalls} total</div>
                  )}
                </div>
                <div className="flex-1 overflow-hidden">
                  <CallTrendSparkline values={isFilterActive ? filteredDaySeries : totalSeries} labels={dayLabels} width={320} height={48} />
                </div>
              </div>

              {/* Per-day axis labels */}
              <div className="grid grid-cols-7 gap-1 text-[10px] text-muted-foreground tabular-nums">
                {dayBuckets.map((d, i) => (
                  <div key={d.key} className="text-center">
                    <div>{format(d.date, "EEE")}</div>
                    <div className="text-foreground font-medium">{isFilterActive ? filteredDaySeries[i] : d.total}</div>
                  </div>
                ))}
              </div>

              {/* Per-outcome sparklines */}
              <div className="border-t border-border pt-4 space-y-2">
                {CALL_OUTCOMES
                  .filter((o) => trendFilter.has(o))
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
                {CALL_OUTCOMES.filter((o) => trendFilter.has(o)).every((o) => outcomeCounts[o] === 0) && (
                  <div className="text-xs text-muted-foreground italic">
                    No calls in the selected outcomes for the last 7 days.
                  </div>
                )}
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
