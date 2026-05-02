import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Phone, PhoneCall, PhoneOff, User, ChevronDown, ChevronUp, Copy, Check, UserCircle2, MapPin, Wallet, Home, Clock } from "lucide-react";
import { fetchTranscripts, fetchLeadById, formatLiveDuration, type CallSession, type CallTranscript, type LinkedLead } from "@/lib/liveCalls";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const COLLAPSED_LIMIT = 4;
const EXPANDED_LIMIT = 50;

export default function LiveCallCard({ session }: { session: CallSession }) {
  const [now, setNow] = useState(() => Date.now());
  const [snippets, setSnippets] = useState<CallTranscript[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusFlash, setStatusFlash] = useState(false);
  const [lead, setLead] = useState<LinkedLead | null>(null);
  const prevStatus = useRef(session.status);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Tick duration once per second while the call is live.
  useEffect(() => {
    if (session.status === "ended" || session.status === "failed") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session.status]);

  // Flash the status badge briefly whenever it transitions.
  useEffect(() => {
    if (prevStatus.current !== session.status) {
      prevStatus.current = session.status;
      setStatusFlash(true);
      const t = setTimeout(() => setStatusFlash(false), 900);
      return () => clearTimeout(t);
    }
  }, [session.status]);

  // Initial transcript load + realtime subscribe per session.
  // Re-load (with bigger limit) when expanded toggles on.
  useEffect(() => {
    let cancelled = false;
    const limit = expanded ? EXPANDED_LIMIT : COLLAPSED_LIMIT;
    void fetchTranscripts(session.id, limit).then((rows) => {
      if (!cancelled) setSnippets(rows);
    });
    const channel = supabase
      .channel(`call-transcripts-${session.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "call_transcripts", filter: `session_id=eq.${session.id}` },
        (payload) => {
          const row = payload.new as unknown as CallTranscript;
          setSnippets((prev) => {
            const cap = expanded ? EXPANDED_LIMIT : COLLAPSED_LIMIT;
            const next = [...prev, row];
            return next.length > cap ? next.slice(next.length - cap) : next;
          });
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [session.id, expanded]);

  // Auto-scroll the transcript pane to the newest snippet.
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [snippets.length, expanded]);

  // Load (and refresh) the linked lead whenever the session's lead_id changes.
  useEffect(() => {
    let cancelled = false;
    if (!session.lead_id) {
      setLead(null);
      return;
    }
    void fetchLeadById(session.lead_id).then((l) => {
      if (!cancelled) setLead(l);
    });
    return () => {
      cancelled = true;
    };
  }, [session.lead_id]);

  const statusMeta =
    session.status === "ringing"
      ? { label: "Ringing", tone: "bg-status-contacted/15 text-status-contacted border-status-contacted/30", Icon: Phone, pulse: true }
      : session.status === "connected"
      ? { label: "Connected", tone: "bg-status-scheduled/15 text-status-scheduled border-status-scheduled/30", Icon: PhoneCall, pulse: true }
      : session.status === "ended"
      ? { label: "Ended", tone: "bg-muted text-muted-foreground border-border", Icon: PhoneOff, pulse: false }
      : { label: "Failed", tone: "bg-destructive/15 text-destructive border-destructive/30", Icon: PhoneOff, pulse: false };

  const StatusIcon = statusMeta.Icon;

  const copyCallerInfo = async () => {
    const lines = [
      `Caller: ${session.caller_phone || "Unknown"}`,
      `Status: ${statusMeta.label}`,
      `Agent: ${session.agent_id}`,
      `Vapi call id: ${session.vapi_call_id}`,
      `Started: ${new Date(session.started_at).toLocaleString()}`,
      session.duration_seconds != null ? `Duration: ${session.duration_seconds}s` : null,
      session.end_reason ? `End reason: ${session.end_reason}` : null,
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(lines);
      setCopied(true);
      toast.success("Caller info copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <Card className="overflow-hidden transition-colors duration-300">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              "h-9 w-9 rounded-full grid place-items-center transition-all duration-500",
              statusMeta.tone,
              statusFlash && "ring-2 ring-offset-2 ring-offset-background ring-primary/40 scale-105",
            )}
          >
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
          <Badge
            variant="outline"
            className={cn(
              "border transition-all duration-500",
              statusMeta.tone,
              statusFlash && "scale-105 shadow-sm",
            )}
          >
            {statusMeta.label}
          </Badge>
          <span className="tabular-nums text-sm text-muted-foreground">{formatLiveDuration(session, now)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={copyCallerInfo}
            aria-label="Copy caller info"
            title="Copy caller info"
          >
            {copied ? <Check className="h-4 w-4 text-status-scheduled" /> : <Copy className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse transcript" : "Expand transcript"}
            aria-expanded={expanded}
            title={expanded ? "Collapse transcript" : "Expand transcript"}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div
          ref={transcriptRef}
          className={cn(
            "rounded-md border border-border bg-muted/30 p-3 overflow-y-auto space-y-1.5 text-sm transition-[max-height] duration-300 ease-out",
            expanded ? "min-h-[180px] max-h-[420px]" : "min-h-[72px] max-h-32",
          )}
          aria-live="polite"
        >
          {snippets.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">Waiting for transcript…</div>
          ) : (
            snippets.map((s) => (
              <div key={s.id} className="flex gap-2 animate-in fade-in slide-in-from-bottom-1 duration-200">
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
        <div className="mt-2 flex items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">
            {snippets.length === 0
              ? "0 lines"
              : `${snippets.length} line${snippets.length === 1 ? "" : "s"}${expanded ? "" : " · expand for more"}`}
          </span>
          {session.lead_id && (
            <a className="text-primary underline-offset-2 hover:underline" href={`/leads?lead=${session.lead_id}`}>
              View linked lead
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}