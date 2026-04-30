import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, ChevronDown, ChevronRight, Download, RefreshCw } from "lucide-react";
import AppShell from "@/components/leaseflow/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/webhook-logs")({
  head: () => ({ meta: [{ title: "Webhook Logs — LeaseFlow" }] }),
  component: WebhookLogsPage,
});

type WebhookStatus =
  | "authorized"
  | "unauthorized"
  | "invalid"
  | "inserted"
  | "failed";

type WebhookLog = {
  id: string;
  request_id: string;
  source: string;
  status: WebhookStatus;
  stage: string;
  http_status: number;
  agent_id: string | null;
  user_id: string | null;
  lead_id: string | null;
  ip: string | null;
  user_agent: string | null;
  duration_ms: number | null;
  error_message: string | null;
  payload_summary: Record<string, unknown> | null;
  created_at: string;
};

const STATUS_OPTIONS: { value: "all" | WebhookStatus; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "inserted", label: "Inserted" },
  { value: "authorized", label: "Authorized" },
  { value: "unauthorized", label: "Unauthorized" },
  { value: "invalid", label: "Invalid" },
  { value: "failed", label: "Failed" },
];

function statusBadgeClass(status: WebhookStatus) {
  switch (status) {
    case "inserted":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "authorized":
      return "bg-sky-500/15 text-sky-400 border-sky-500/30";
    case "unauthorized":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "invalid":
      return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    case "failed":
      return "bg-destructive/15 text-destructive border-destructive/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function WebhookLogsPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | WebhookStatus>("all");
  const [agentFilter, setAgentFilter] = useState("");
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = async () => {
    if (!user) return;
    setLoading(true);
    let query = supabase
      .from("webhook_logs" as never)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    const trimmedAgent = agentFilter.trim();
    if (trimmedAgent) query = query.ilike("agent_id", `%${trimmedAgent}%`);
    if (fromDate) query = query.gte("created_at", fromDate.toISOString());
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      query = query.lte("created_at", end.toISOString());
    }

    const { data, error } = await query;
    if (error) {
      console.error(error);
      setLogs([]);
    } else {
      setLogs((data ?? []) as unknown as WebhookLog[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, statusFilter, fromDate, toDate]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: logs.length };
    for (const l of logs) c[l.status] = (c[l.status] ?? 0) + 1;
    return c;
  }, [logs]);

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const exportCsv = () => {
    const headers = [
      "request_id",
      "status",
      "agent_id",
      "created_at",
      "payload_summary",
    ];
    const escape = (val: unknown) => {
      const s =
        val === null || val === undefined
          ? ""
          : typeof val === "string"
            ? val
            : JSON.stringify(val);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rows = logs.map((l) =>
      [
        l.request_id,
        l.status,
        l.agent_id ?? "",
        l.created_at,
        l.payload_summary ?? {},
      ]
        .map(escape)
        .join(","),
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `webhook-logs-${format(new Date(), "yyyyMMdd-HHmmss")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell gated>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Webhook Logs</h1>
            <p className="text-sm text-muted-foreground">
              Every Vapi webhook attempt with payload summaries for debugging.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={logs.length === 0}
              className="gap-2"
            >
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={load} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Total", value: counts.total ?? 0 },
            { label: "Inserted", value: counts.inserted ?? 0 },
            { label: "Unauthorized", value: counts.unauthorized ?? 0 },
            { label: "Invalid", value: counts.invalid ?? 0 },
            { label: "Failed", value: counts.failed ?? 0 },
            { label: "Authorized", value: counts.authorized ?? 0 },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-lg border border-border bg-card p-3"
            >
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className="text-xl font-semibold">{k.value}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Status</label>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Agent ID</label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void load();
              }}
              className="flex gap-2"
            >
              <Input
                placeholder="agent_…"
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="w-56"
              />
              <Button type="submit" variant="secondary">
                Apply
              </Button>
            </form>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">From</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-44 justify-start text-left font-normal",
                    !fromDate && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {fromDate ? format(fromDate, "PP") : "Any"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={fromDate}
                  onSelect={setFromDate}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">To</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-44 justify-start text-left font-normal",
                    !toDate && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {toDate ? format(toDate, "PP") : "Any"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={toDate}
                  onSelect={setToDate}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          {(fromDate || toDate || agentFilter || statusFilter !== "all") && (
            <Button
              variant="ghost"
              onClick={() => {
                setStatusFilter("all");
                setAgentFilter("");
                setFromDate(undefined);
                setToDate(undefined);
              }}
            >
              Clear
            </Button>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-12 px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
            <div className="col-span-3">When</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-1">HTTP</div>
            <div className="col-span-3">Agent</div>
            <div className="col-span-2">Stage</div>
            <div className="col-span-1 text-right">Duration</div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              Loading…
            </div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No webhook attempts match these filters.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {logs.map((log) => {
                const isOpen = !!expanded[log.id];
                return (
                  <li key={log.id}>
                    <button
                      onClick={() => toggle(log.id)}
                      className="w-full grid grid-cols-12 items-center gap-2 px-4 py-3 text-left hover:bg-accent/40 transition-colors"
                    >
                      <div className="col-span-3 flex items-center gap-2 text-sm">
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span>
                          {format(new Date(log.created_at), "MMM d, HH:mm:ss")}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "capitalize",
                            statusBadgeClass(log.status),
                          )}
                        >
                          {log.status}
                        </Badge>
                      </div>
                      <div className="col-span-1 text-sm tabular-nums">
                        {log.http_status}
                      </div>
                      <div className="col-span-3 text-sm font-mono truncate text-muted-foreground">
                        {log.agent_id ?? "—"}
                      </div>
                      <div className="col-span-2 text-sm text-muted-foreground truncate">
                        {log.stage}
                      </div>
                      <div className="col-span-1 text-sm tabular-nums text-right text-muted-foreground">
                        {log.duration_ms != null ? `${log.duration_ms}ms` : "—"}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="bg-muted/30 px-4 py-3 border-t border-border">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                          <DetailRow label="Request ID" value={log.request_id} mono />
                          <DetailRow label="Lead ID" value={log.lead_id ?? "—"} mono />
                          <DetailRow label="IP" value={log.ip ?? "—"} />
                          <DetailRow
                            label="User-Agent"
                            value={log.user_agent ?? "—"}
                          />
                          {log.error_message && (
                            <DetailRow
                              label="Error"
                              value={log.error_message}
                              className="text-destructive md:col-span-2"
                            />
                          )}
                          <div className="md:col-span-2">
                            <div className="text-muted-foreground mb-1">
                              Payload summary
                            </div>
                            <pre className="rounded-md bg-background border border-border p-3 overflow-auto text-[11px] leading-relaxed max-h-72">
{JSON.stringify(log.payload_summary ?? {}, null, 2)}
                            </pre>
                          </div>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function DetailRow({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-muted-foreground">{label}</div>
      <div className={cn("break-all", mono && "font-mono")}>{value}</div>
    </div>
  );
}