import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Lead } from "@/lib/leaseflow";
import type { CallLog } from "@/lib/calls";
import {
  buildLink,
  logMessageAttempt,
  normalizePhone,
  parseChannelFromNote,
  parseFailureReason,
  renderTemplate,
  type MessageChannel,
} from "@/lib/templates";

const STAGGER_MS = 400;

type Candidate = {
  lead: Lead;
  log: CallLog;
  channel: MessageChannel;
  templateName: string;
  body: string;
  reason: string;
};

type Phase = "scanning" | "ready" | "running" | "done";

/** Extract the rendered body from a stored note (header + blank line + body). */
function extractBody(note: string | null | undefined): string {
  if (!note) return "";
  const idx = note.indexOf("\n\n");
  return idx >= 0 ? note.slice(idx + 2) : note;
}

/** Extract template name from header: 'WhatsApp failed · "Tpl name" — Reason'. */
function extractTemplateName(note: string | null | undefined): string {
  if (!note) return "Custom message";
  const m = note.split("\n", 1)[0]?.match(/"([^"]+)"/);
  return m?.[1] ?? "Custom message";
}

export default function RetryFailedMessagesDialog({
  leads,
  open,
  onOpenChange,
  onDone,
}: {
  leads: Lead[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone?: () => void;
}) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>("scanning");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{ leadId: string; status: "sent" | "failed"; reason?: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    setPhase("scanning");
    setCandidates([]);
    setProgress(0);
    setResults([]);
    if (!user || leads.length === 0) {
      setPhase("ready");
      return;
    }
    (async () => {
      try {
        const ids = leads.map((l) => l.id);
        const { data, error } = await supabase
          .from("call_logs" as never)
          .select("*")
          .in("lead_id", ids)
          .eq("outcome", "message_failed")
          .order("created_at", { ascending: false });
        if (error) throw error;
        const logs = (data ?? []) as unknown as CallLog[];
        // Keep only most-recent failure per lead
        const seen = new Set<string>();
        const latest: CallLog[] = [];
        for (const l of logs) {
          if (seen.has(l.lead_id)) continue;
          seen.add(l.lead_id);
          latest.push(l);
        }
        const leadById = new Map(leads.map((l) => [l.id, l]));
        const cands: Candidate[] = latest
          .map((log): Candidate | null => {
            const lead = leadById.get(log.lead_id);
            if (!lead) return null;
            return {
              lead,
              log,
              channel: parseChannelFromNote(log.notes),
              templateName: extractTemplateName(log.notes),
              body: extractBody(log.notes),
              reason: parseFailureReason(log.notes),
            };
          })
          .filter((c): c is Candidate => c !== null);
        setCandidates(cands);
        setPhase("ready");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to scan failed messages");
        setPhase("ready");
      }
    })();
  }, [open, user, leads]);

  const runRetry = async () => {
    if (!user || candidates.length === 0) return;
    setPhase("running");
    setProgress(0);
    const out: { leadId: string; status: "sent" | "failed"; reason?: string }[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const phone = normalizePhone(c.lead.phone);
      const baseLog = {
        userId: user.id,
        leadId: c.lead.id,
        channel: c.channel,
        templateName: c.templateName,
        preview: c.body.slice(0, 280),
      };
      if (phone.length < 6) {
        out.push({ leadId: c.lead.id, status: "failed", reason: "No valid phone number" });
        void logMessageAttempt({ ...baseLog, status: "failed", failureReason: "No valid phone number (retry)" });
      } else {
        // Re-render body in case template variables now resolve differently.
        const msg = renderTemplate(c.body, c.lead, null);
        const link = buildLink(c.channel, c.lead.phone ?? "", msg);
        if (!link) {
          out.push({ leadId: c.lead.id, status: "failed", reason: "Could not build link" });
          void logMessageAttempt({ ...baseLog, status: "failed", failureReason: "Could not build link (retry)" });
        } else {
          if (i > 0) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, STAGGER_MS));
          }
          const w = window.open(link, "_blank", "noopener,noreferrer");
          if (w) {
            out.push({ leadId: c.lead.id, status: "sent" });
            void logMessageAttempt({ ...baseLog, preview: msg.slice(0, 280), status: "sent" });
          } else {
            out.push({ leadId: c.lead.id, status: "failed", reason: "Browser blocked popup" });
            void logMessageAttempt({ ...baseLog, preview: msg.slice(0, 280), status: "failed", failureReason: "Browser blocked popup (retry)" });
          }
        }
      }
      setResults([...out]);
      setProgress(Math.round(((i + 1) / candidates.length) * 100));
    }
    const sent = out.filter((r) => r.status === "sent").length;
    const failed = out.length - sent;
    if (sent > 0 && failed === 0) toast.success(`Re-sent ${sent} message${sent === 1 ? "" : "s"}`);
    else if (sent > 0) toast.warning(`Re-sent ${sent}, ${failed} still failing`);
    else toast.error(`All ${failed} retries failed — check popup settings or phone numbers`);
    setPhase("done");
    onDone?.();
  };

  const close = () => {
    if (phase === "running") return;
    onOpenChange(false);
  };

  const noFailures = phase === "ready" && candidates.length === 0;
  const resultByLead = new Map(results.map((r) => [r.leadId, r]));

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? close() : onOpenChange(v))}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Retry failed messages
          </DialogTitle>
          <DialogDescription>
            Re-sends the most recent failed message for each selected lead, using the originally failed template body.
          </DialogDescription>
        </DialogHeader>

        {phase === "scanning" ? (
          <div className="py-8 text-sm text-center text-muted-foreground">Scanning {leads.length} selected lead{leads.length === 1 ? "" : "s"} for failures…</div>
        ) : noFailures ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            None of the {leads.length} selected lead{leads.length === 1 ? " has" : "s have"} a failed message to retry.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {candidates.length} lead{candidates.length === 1 ? "" : "s"} with a failed message
              </span>
              {phase !== "ready" && (
                <span className="tabular-nums font-medium">{progress}%</span>
              )}
            </div>
            {phase !== "ready" && <Progress value={progress} className="h-2" />}

            <ul className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {candidates.map((c) => {
                const r = resultByLead.get(c.lead.id);
                return (
                  <li key={c.lead.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.lead.full_name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {c.channel === "sms" ? "SMS" : "WhatsApp"} · {c.lead.phone ?? "no phone"} · last fail: {c.reason}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {!r ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                          {phase === "running" ? "Pending…" : "Queued"}
                        </span>
                      ) : r.status === "sent" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary border border-primary/30 px-2 py-0.5 text-[11px] font-medium">
                          <CheckCircle2 className="h-3 w-3" /> Sent
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-destructive/15 text-destructive border border-destructive/30 px-2 py-0.5 text-[11px] font-medium"
                          title={r.reason}
                        >
                          <XCircle className="h-3 w-3" /> Failed
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Allow popups for this site so the browser can open all chats in sequence.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={close} disabled={phase === "running"}>
            {phase === "done" ? "Close" : "Cancel"}
          </Button>
          {!noFailures && phase !== "done" && (
            <Button onClick={runRetry} disabled={phase !== "ready" || candidates.length === 0} className="gap-2">
              <RefreshCw className={phase === "running" ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {phase === "running" ? "Retrying…" : `Retry ${candidates.length}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}