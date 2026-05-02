import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "@/components/leaseflow/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import LiveCallCard from "@/components/leaseflow/LiveCallCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchActiveSessions,
  fetchRecentEnded,
  type CallSession,
} from "@/lib/liveCalls";
import { Badge } from "@/components/ui/badge";
import { PhoneCall, PhoneOff, Phone, Activity, PlugZap } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/live-calls")({
  head: () => ({
    meta: [
      { title: "Live Calls — LeaseFlow" },
      { name: "description", content: "Real-time view of active Vapi calls, statuses, and transcript snippets." },
      { property: "og:title", content: "Live Calls — LeaseFlow" },
      { property: "og:description", content: "Real-time view of active Vapi calls, statuses, and transcript snippets." },
    ],
  }),
  component: LiveCallsPage,
});

function LiveCallsPage() {
  const { user } = useAuth();
  const [active, setActive] = useState<CallSession[]>([]);
  const [ended, setEnded] = useState<CallSession[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [a, e] = await Promise.all([fetchActiveSessions(), fetchRecentEnded(1)]);
      setActive(a);
      setEnded(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void reload();
    const poll = setInterval(reload, 15_000);

    const channel = supabase
      .channel("call-sessions-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "call_sessions" },
        () => {
          void reload();
        },
      )
      .subscribe();

    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [user, reload]);

  const counts = useMemo(() => {
    const ringing = active.filter((s) => s.status === "ringing").length;
    const connected = active.filter((s) => s.status === "connected").length;
    return { active: active.length, ringing, connected, ended: ended.length };
  }, [active, ended]);

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Live Calls</h1>
          <p className="text-sm text-muted-foreground">
            Real-time view of active Vapi sessions and transcript snippets.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link to="/vapi-setup">
            <PlugZap className="h-4 w-4" /> Vapi Setup
          </Link>
        </Button>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Active now" value={counts.active} icon={Activity} accent="text-primary" />
        <StatTile label="Ringing" value={counts.ringing} icon={Phone} accent="text-status-contacted" />
        <StatTile label="Connected" value={counts.connected} icon={PhoneCall} accent="text-status-scheduled" />
        <StatTile label="Ended (1h)" value={counts.ended} icon={PhoneOff} accent="text-muted-foreground" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Active sessions */}
        <section className="lg:col-span-3 space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Active sessions
          </h2>
          {loading ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent></Card>
          ) : active.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center space-y-3">
                <PhoneCall className="h-8 w-8 mx-auto text-muted-foreground" />
                <div className="font-medium">No live calls right now</div>
                <p className="text-sm text-muted-foreground">
                  Place a test call from Vapi or send a webhook from{" "}
                  <Link to="/vapi-setup" className="text-primary hover:underline">Vapi Setup</Link>.
                </p>
              </CardContent>
            </Card>
          ) : (
            active.map((s) => <LiveCallCard key={s.id} session={s} />)
          )}
        </section>

        {/* Recent ended */}
        <aside className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Recent ended (last hour)
          </h2>
          <Card>
            <CardContent className="p-0">
              {ended.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground text-center">No calls yet</div>
              ) : (
                <ul className="divide-y divide-border">
                  {ended.map((s) => {
                    const dur = s.duration_seconds ?? 0;
                    const m = Math.floor(dur / 60);
                    const sec = dur % 60;
                    return (
                      <li key={s.id} className="px-4 py-3 flex items-center gap-3">
                        <PhoneOff className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {s.caller_phone || "Unknown"}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {s.end_reason || "ended"} · {s.ended_at ? format(new Date(s.ended_at), "HH:mm:ss") : ""}
                          </div>
                        </div>
                        <Badge variant="outline" className="tabular-nums">
                          {m}:{String(sec).padStart(2, "0")}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </AppShell>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <Icon className={`h-5 w-5 ${accent}`} />
        <div>
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}