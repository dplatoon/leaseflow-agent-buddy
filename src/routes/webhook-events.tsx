import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  CalendarIcon,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  RefreshCw,
  Search,
} from "lucide-react";
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
import { toast } from "sonner";

export const Route = createFileRoute("/webhook-events")({
  head: () => ({
    meta: [
      { title: "Webhook Events — LeaseFlow" },
      {
        name: "description",
        content:
          "Inspect every Vapi webhook event with full request metadata, payload, and response details.",
      },
    ],
  }),
  component: WebhookEventsPage,
});

type WebhookStatus =
  | "authorized"
  | "unauthorized"
  | "invalid"
  | "inserted"
  | "failed";

type WebhookEvent = {
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

type AgentRow = { agent_id: string; name: string };

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

function buildResponseBody(ev: WebhookEvent) {
  const base: Record<string, unknown> = { request_id: ev.request_id };
  if (ev.status === "inserted") {
    base.success = true;
    if (ev.lead_id) base.lead_id = ev.lead_id;
  } else if (ev.error_message) {
    base.error = ev.error_message;
  }
  return base;
}

function WebhookEventsPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | WebhookStatus>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
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
    if (agentFilter !== "all") query = query.eq("agent_id", agentFilter);
    if (fromDate) query = query.gte("created_at", fromDate.toISOString());
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      query = query.lte("created_at", end.toISOString());
    }

    const { data, error } = await query;
    if (error) {
      console.error(error);
      toast.error("Failed to load webhook events");
      setEvents([]);
    } else {
      setEvents((data ?? []) as unknown as WebhookEvent[]);
    }
    setLoading(false);
  };

  const loadAgents = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("agents")
      .select("agent_id, name")
      .order("name", { ascending: true });
    setAgents((data ?? []) as AgentRow[]);
  };

  useEffect(() => {
    void loadAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, statusFilter, agentFilter, fromDate, toDate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) => {
      return (
        e.request_id.toLowerCase().includes(q) ||
        (e.lead_id ?? "").toLowerCase().includes(q) ||
        (e.agent_id ?? "").toLowerCase().includes(q) ||
        (e.error_message ?? "").toLowerCase().includes(q) ||
        e.stage.toLowerCase().includes(q)
      );
    });
  }, [events, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: filtered.length };
    for (const l of filtered) c[l.status] = (c[l.status] ?? 0) + 1;
    return c;
  }, [filtered]);

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed");
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `webhook-events-${format(new Date(), "yyyyMMdd-HHmmss")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => {
    setStatusFilter("all");
    setAgentFilter("all");
    setSearch("");
    setFromDate(undefined);
    setToDate(undefined);
  };

  const hasFilters =
    statusFilter !== "all" ||
    agentFilter !== "all" ||
    !!search ||
    !!fromDate ||
    !!toDate;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Webhook Events
            </h1>
            <p className="text-sm text-muted-foreground">
              Inspect every Vapi webhook attempt with full request and response
              details.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/webhook-logs">Legacy log view</Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportJson}
              disabled={filtered.length === 0}
              className="gap-2"
            >
              <Download className="h-4 w-4" /> Export JSON
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
            <label className="text-xs text-muted-foreground">Agent</label>
            <Select
              value={agentFilter}
              onValueChange={(v) => setAgentFilter(v)}
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder="All agents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.agent_id} value={a.agent_id}>
                    {a.name}{" "}
                    <span className="text-muted-foreground">
                      · {a.agent_id.slice(0, 16)}…
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">Search</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="request_id, lead_id, error…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>

          {hasFilters && (
            <Button variant="ghost" onClick={clearFilters}>
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
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No webhook events match these filters.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((ev) => {
                const isOpen = !!expanded[ev.id];
                const responseBody = buildResponseBody(ev);
                return (
                  <li key={ev.id}>
                    <button
                      onClick={() => toggle(ev.id)}
                      className="w-full grid grid-cols-12 items-center gap-2 px-4 py-3 text-left hover:bg-accent/40 transition-colors"
                    >
                      <div className="col-span-3 flex items-center gap-2 text-sm">
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span>
                          {format(new Date(ev.created_at), "MMM d, HH:mm:ss")}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "capitalize",
                            statusBadgeClass(ev.status),
                          )}
                        >
                          {ev.status}
                        </Badge>
                      </div>
                      <div className="col-span-1 text-sm tabular-nums">
                        {ev.http_status}
                      </div>
                      <div className="col-span-3 text-sm font-mono truncate text-muted-foreground">
                        {ev.agent_id ?? "—"}
                      </div>
                      <div className="col-span-2 text-sm text-muted-foreground truncate">
                        {ev.stage}
                      </div>
                      <div className="col-span-1 text-sm tabular-nums text-right text-muted-foreground">
                        {ev.duration_ms != null ? `${ev.duration_ms}ms` : "—"}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="bg-muted/30 px-4 py-4 border-t border-border space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                          <DetailRow
                            label="Request ID"
                            value={ev.request_id}
                            mono
                            onCopy={() => copy(ev.request_id, "Request ID")}
                          />
                          <DetailRow
                            label="Lead ID"
                            value={ev.lead_id ?? "—"}
                            mono
                            onCopy={
                              ev.lead_id
                                ? () => copy(ev.lead_id!, "Lead ID")
                                : undefined
                            }
                          />
                          <DetailRow label="IP" value={ev.ip ?? "—"} />
                          <DetailRow
                            label="User-Agent"
                            value={ev.user_agent ?? "—"}
                          />
                          <DetailRow
                            label="Source"
                            value={ev.source}
                          />
                          <DetailRow
                            label="Duration"
                            value={
                              ev.duration_ms != null
                                ? `${ev.duration_ms} ms`
                                : "—"
                            }
                          />
                          {ev.error_message && (
                            <DetailRow
                              label="Error"
                              value={ev.error_message}
                              className="text-destructive md:col-span-2"
                            />
                          )}
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <PayloadBlock
                            title="Request payload"
                            data={ev.payload_summary ?? {}}
                            onCopy={() =>
                              copy(
                                JSON.stringify(
                                  ev.payload_summary ?? {},
                                  null,
                                  2,
                                ),
                                "Payload",
                              )
                            }
                          />
                          <PayloadBlock
                            title={`Response · HTTP ${ev.http_status}`}
                            data={responseBody}
                            onCopy={() =>
                              copy(
                                JSON.stringify(responseBody, null, 2),
                                "Response",
                              )
                            }
                          />
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
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
  onCopy?: () => void;
}) {
  return (
    <div className={className}>
      <div className="text-muted-foreground flex items-center justify-between">
        <span>{label}</span>
        {onCopy && (
          <button
            onClick={onCopy}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={`Copy ${label}`}
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className={cn("break-all", mono && "font-mono")}>{value}</div>
    </div>
  );
}

function PayloadBlock({
  title,
  data,
  onCopy,
}: {
  title: string;
  data: unknown;
  onCopy: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs text-muted-foreground">{title}</div>
        <button
          onClick={onCopy}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
        >
          <Copy className="h-3 w-3" /> Copy
        </button>
      </div>
      <pre className="rounded-md bg-background border border-border p-3 overflow-auto text-[11px] leading-relaxed max-h-72">
{JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}