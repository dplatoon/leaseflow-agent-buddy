import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, CheckCircle2, RefreshCw, SkipForward, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/leaseflow";
import type { CallLog } from "@/lib/calls";
import {
  buildLink,
  fetchTemplates,
  logMessageAttempt,
  normalizePhone,
  parseChannelFromNote,
  parseFailureReason,
  renderTemplate,
  type MessageChannel,
  type MessageTemplate,
} from "@/lib/templates";

const STAGGER_MS = 400;
const BATCH_SIZE = 25;

type Candidate = {
  lead: Lead;
  log: CallLog;
  channel: MessageChannel;
  templateName: string;
  body: string;
  reason: string;
  /** Live template body when we found one matching templateName; falls back to stored body. */
  liveBody: string | null;
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
  const [results, setResults] = useState<{ leadId: string; status: "sent" | "failed" | "skipped"; reason?: string }[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [batchStart, setBatchStart] = useState(0);
  const [dedupedCount, setDedupedCount] = useState(0);

  useEffect(() => {
    if (!open) return;
    setPhase("scanning");
    setCandidates([]);
    setProgress(0);
    setResults([]);
    setSkipped(new Set());
    setBatchStart(0);
    setDedupedCount(0);
    if (!user || leads.length === 0) {
      setPhase("ready");
      return;
    }
    (async () => {
      try {
        const ids = leads.map((l) => l.id);
        // Pull all message-related logs (sent + failed) so we can dedupe leads
        // that already have a successful send AFTER their latest failure.
        const { data, error } = await supabase
          .from("call_logs" as never)
          .select("*")
          .in("lead_id", ids)
          .in("outcome", ["message_failed", "message_sent"])
          .order("created_at", { ascending: false });
        if (error) throw error;
        const logs = (data ?? []) as unknown as CallLog[];
        // For each lead, find the latest log overall and the latest failure.
        const latestPerLead = new Map<string, CallLog>();
        const latestFailurePerLead = new Map<string, CallLog>();
        for (const l of logs) {
          if (!latestPerLead.has(l.lead_id)) latestPerLead.set(l.lead_id, l);
          if (l.outcome === "message_failed" && !latestFailurePerLead.has(l.lead_id)) {
            latestFailurePerLead.set(l.lead_id, l);
          }
        }
        // Keep only leads whose latest message log IS a failure (dedupe).
        const latest: CallLog[] = [];
        let deduped = 0;
        for (const [leadId, fail] of latestFailurePerLead) {
          const top = latestPerLead.get(leadId);
          if (top && top.outcome === "message_sent") {
            deduped += 1;
            continue;
          }
          latest.push(fail);
        }
        setDedupedCount(deduped);
        // Load live templates so we can re-render the original template body
        // with current lead variables.
        let templates: MessageTemplate[] = [];
        try {
          templates = await fetchTemplates();
        } catch {
          // Non-fatal: fall back to stored body.
        }
        const tplByName = new Map(templates.map((t) => [t.name.trim().toLowerCase(), t]));
        const leadById = new Map(leads.map((l) => [l.id, l]));
        const cands: Candidate[] = latest
          .map((log): Candidate | null => {
            const lead = leadById.get(log.lead_id);
            if (!lead) return null;
            const tplName = extractTemplateName(log.notes);
            const liveTpl = tplByName.get(tplName.trim().toLowerCase());
            return {
              lead,
              log,
              channel: parseChannelFromNote(log.notes),
              templateName: tplName,
              body: extractBody(log.notes),
              reason: parseFailureReason(log.notes),
              liveBody: liveTpl?.body ?? null,
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

  const runRetry = async (startIndex: number) => {
    if (!user || candidates.length === 0) return;
    const endIndex = Math.min(startIndex + BATCH_SIZE, candidates.length);
    const batch = candidates.slice(startIndex, endIndex);
    setPhase("running");
    setProgress(0);
    const out: { leadId: string; status: "sent" | "failed" | "skipped"; reason?: string }[] = [...results];
    for (let i = 0; i < batch.length; i++) {
      const c = batch[i];
      if (skipped.has(c.lead.id)) {
        out.push({ leadId: c.lead.id, status: "skipped" });
        setResults([...out]);
        setProgress(Math.round(((i + 1) / batch.length) * 100));
        continue;
      }
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
        // Use live template body when available so updated lead vars actually apply.
        const source = c.liveBody ?? c.body;
        const msg = renderTemplate(source, c.lead, null);
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
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 60));
          const blocked = !w || w.closed === true;
          if (!blocked) {
            out.push({ leadId: c.lead.id, status: "sent" });
            void logMessageAttempt({ ...baseLog, preview: msg.slice(0, 280), status: "sent" });
          } else {
            out.push({ leadId: c.lead.id, status: "failed", reason: "Browser blocked popup" });
            void logMessageAttempt({ ...baseLog, preview: msg.slice(0, 280), status: "failed", failureReason: "Browser blocked popup (retry)" });
          }
        }
      }
      setResults([...out]);
      setProgress(Math.round(((i + 1) / batch.length) * 100));
    }
    const batchOut = out.slice(out.length - batch.length);
    const sent = batchOut.filter((r) => r.status === "sent").length;
    const failed = batchOut.filter((r) => r.status === "failed").length;
    const skip = batchOut.filter((r) => r.status === "skipped").length;
    if (sent > 0 && failed === 0) toast.success(`Re-sent ${sent} message${sent === 1 ? "" : "s"}${skip ? ` (skipped ${skip})` : ""}`);
    else if (sent > 0) toast.warning(`Re-sent ${sent}, ${failed} still failing${skip ? `, ${skip} skipped` : ""}`);
    else if (failed > 0) toast.error(`All ${failed} retries failed — check popup settings or phone numbers`);
    else if (skip > 0) toast.info(`Skipped ${skip} message${skip === 1 ? "" : "s"}`);
    setBatchStart(endIndex);
    setPhase("done");
    onDone?.();
  };

  const close = () => {
    if (phase === "running") return;
    onOpenChange(false);
  };

  const noFailures = phase === "ready" && candidates.length === 0;
  const resultByLead = new Map(results.map((r) => [r.leadId, r]));
  const remaining = Math.max(0, candidates.length - batchStart);
  const currentBatchEnd = Math.min(batchStart + BATCH_SIZE, candidates.length);
  const currentBatchSize = Math.max(0, currentBatchEnd - batchStart);

  const toggleSkip = (leadId: string) => {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId); else next.add(leadId);
      return next;
    });
  };

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
            {dedupedCount > 0 && (
              <div className="mt-1 text-[11px]">{dedupedCount} lead{dedupedCount === 1 ? " was" : "s were"} skipped (already messaged successfully after the failure).</div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {candidates.length} lead{candidates.length === 1 ? "" : "s"} with a failed message
                {dedupedCount > 0 && ` · ${dedupedCount} already resolved`}
                {candidates.length > BATCH_SIZE && ` · batch of ${currentBatchSize} (${batchStart + 1}–${currentBatchEnd})`}
              </span>
              {phase !== "ready" && (
                <span className="tabular-nums font-medium">{progress}%</span>
              )}
            </div>
            {phase !== "ready" && <Progress value={progress} className="h-2" />}

            <ul className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {candidates.map((c, idx) => {
                const r = resultByLead.get(c.lead.id);
                const inCurrentBatch = idx >= batchStart && idx < currentBatchEnd;
                const isSkipped = skipped.has(c.lead.id);
                return (
                  <li
                    key={c.lead.id}
                    className={cn(
                      "flex items-center justify-between gap-3 px-3 py-2 text-sm",
                      !inCurrentBatch && !r && "opacity-50",
                      isSkipped && "opacity-60",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.lead.full_name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {c.channel === "sms" ? "SMS" : "WhatsApp"} · {c.lead.phone ?? "no phone"} · last fail: {c.reason}
                        {c.liveBody && " · live template"}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      {!r && phase === "ready" && inCurrentBatch && (
                        <button
                          type="button"
                          onClick={() => toggleSkip(c.lead.id)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                            isSkipped
                              ? "bg-muted text-foreground border-border"
                              : "border-border text-muted-foreground hover:bg-muted",
                          )}
                          title={isSkipped ? "Include this lead" : "Skip this lead"}
                        >
                          <SkipForward className="h-3 w-3" />
                          {isSkipped ? "Skipped" : "Skip"}
                        </button>
                      )}
                      {!r ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                          {phase === "running" && inCurrentBatch ? "Pending…" : inCurrentBatch ? "Queued" : "Next batch"}
                        </span>
                      ) : r.status === "sent" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary border border-primary/30 px-2 py-0.5 text-[11px] font-medium">
                          <CheckCircle2 className="h-3 w-3" /> Sent
                        </span>
                      ) : r.status === "skipped" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground border border-border px-2 py-0.5 text-[11px] font-medium">
                          <SkipForward className="h-3 w-3" /> Skipped
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
              Allow popups for this site so the browser can open all chats in sequence. Batches of {BATCH_SIZE} keep popup blockers happy.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={close} disabled={phase === "running"}>
            {phase === "done" && remaining === 0 ? "Close" : "Cancel"}
          </Button>
          {!noFailures && phase === "ready" && (
            <Button onClick={() => runRetry(batchStart)} disabled={candidates.length === 0} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Retry {currentBatchSize}{candidates.length > BATCH_SIZE ? ` of ${candidates.length}` : ""}
            </Button>
          )}
          {phase === "running" && (
            <Button disabled className="gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Retrying…
            </Button>
          )}
          {phase === "done" && remaining > 0 && (
            <Button onClick={() => runRetry(batchStart)} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Run next {Math.min(BATCH_SIZE, remaining)} ({remaining} left)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}