import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Phone, PhoneCall, PhoneOff, User } from "lucide-react";
import { fetchTranscripts, formatLiveDuration, type CallSession, type CallTranscript } from "@/lib/liveCalls";
import { supabase } from "@/integrations/supabase/client";

export default function LiveCallCard({ session }: { session: CallSession }) {
  const [now, setNow] = useState(() => Date.now());
  const [snippets, setSnippets] = useState<CallTranscript[]>([]);

  // Tick duration once per second while the call is live.
  useEffect(() => {
    if (session.status === "ended" || session.status === "failed") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session.status]);

  // Initial transcript load + realtime subscribe per session.
  useEffect(() => {
    let cancelled = false;
    void fetchTranscripts(session.id, 4).then((rows) => {
      if (!cancelled) setSnippets(rows);
    });
    const channel = supabase
      .channel(`call-transcripts-${session.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "call_transcripts", filter: `session_id=eq.${session.id}` },
        (payload) => {
          const row = payload.new as unknown as CallTranscript;
          setSnippets((prev) => [...prev.slice(-3), row]);
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [session.id]);

  const statusMeta =
    session.status === "ringing"
      ? { label: "Ringing", tone: "bg-status-contacted/15 text-status-contacted border-status-contacted/30", Icon: Phone, pulse: true }
      : session.status === "connected"
      ? { label: "Connected", tone: "bg-status-scheduled/15 text-status-scheduled border-status-scheduled/30", Icon: PhoneCall, pulse: true }
      : session.status === "ended"
      ? { label: "Ended", tone: "bg-muted text-muted-foreground border-border", Icon: PhoneOff, pulse: false }
      : { label: "Failed", tone: "bg-destructive/15 text-destructive border-destructive/30", Icon: PhoneOff, pulse: false };

  const StatusIcon = statusMeta.Icon;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn("h-9 w-9 rounded-full grid place-items-center", statusMeta.tone)}>
            <StatusIcon className={cn("h-4 w-4", statusMeta.pulse && "animate-pulse")} />
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{session.caller_phone || "Unknown caller"}</div>
            <div className="text-xs text-muted-foreground truncate">
              Agent <span className="font-mono">{session.agent_id}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className={cn("border", statusMeta.tone)}>
            {statusMeta.label}
          </Badge>
          <span className="tabular-nums text-sm text-muted-foreground">{formatLiveDuration(session, now)}</span>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="rounded-md border border-border bg-muted/30 p-3 min-h-[72px] max-h-32 overflow-y-auto space-y-1.5 text-sm">
          {snippets.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">Waiting for transcript…</div>
          ) : (
            snippets.map((s) => (
              <div key={s.id} className="flex gap-2">
                <span
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold",
                    s.role === "assistant" ? "text-primary" : s.role === "user" ? "text-status-scheduled" : "text-muted-foreground",
                  )}
                >
                  <User className="h-3 w-3" />
                  {s.role}
                </span>
                <span className="text-foreground/90">{s.text}</span>
              </div>
            ))
          )}
        </div>
        {session.lead_id && (
          <div className="mt-2 text-xs">
            <a className="text-primary underline-offset-2 hover:underline" href={`/leads?lead=${session.lead_id}`}>
              View linked lead
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}