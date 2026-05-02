import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "@/components/leaseflow/AppShell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  PlugZap,
  Copy,
  Check,
  Eye,
  EyeOff,
  RefreshCw,
  Send,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  Globe,
  KeyRound,
  Hash,
  PhoneCall,
  CircleDot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listAgents, regenerateAgentSecret } from "@/server/agents.functions";
import { sendWebhookTest } from "@/server/webhook-test.functions";
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

export const Route = createFileRoute("/vapi-setup")({
  head: () => ({
    meta: [
      { title: "Vapi Setup — LeaseFlow" },
      { name: "description", content: "Step-by-step guide to connect your Vapi assistant: server URL, webhook secret, and live test." },
      { property: "og:title", content: "Vapi Setup — LeaseFlow" },
      { property: "og:description", content: "Step-by-step guide to connect your Vapi assistant: server URL, webhook secret, and live test." },
    ],
  }),
  component: VapiSetupPage,
});

type Agent = {
  id: string;
  name: string;
  agent_id: string;
  webhook_secret: string;
  is_active: boolean;
  created_at: string;
};

type CheckState = "idle" | "pending" | "ok" | "fail";

type LastTest = {
  at: string;
  status: number;
  authOk: boolean;
  insertOk: boolean;
  durationMs: number;
  message: string;
};

function lastTestKey(rowId: string) {
  return `leaseflow:vapi-setup:lastTest:${rowId}`;
}
function vapiHintKey(rowId: string) {
  return `leaseflow:vapi-setup:vapiAssistantHint:${rowId}`;
}

function StatusPill({ state, label }: { state: CheckState; label: string }) {
  const meta = {
    idle: { tone: "bg-muted text-muted-foreground border-border", Icon: CircleDot },
    pending: { tone: "bg-muted text-muted-foreground border-border", Icon: Loader2 },
    ok: { tone: "bg-status-scheduled/15 text-status-scheduled border-status-scheduled/30", Icon: CheckCircle2 },
    fail: { tone: "bg-destructive/15 text-destructive border-destructive/30", Icon: XCircle },
  }[state];
  const Icon = meta.Icon;
  return (
    <Badge variant="outline" className={cn("border gap-1.5", meta.tone)}>
      <Icon className={cn("h-3.5 w-3.5", state === "pending" && "animate-spin")} />
      {label}
    </Badge>
  );
}

function CopyField({
  value,
  masked = false,
  monospace = true,
}: {
  value: string;
  masked?: boolean;
  monospace?: boolean;
}) {
  const [revealed, setRevealed] = useState(!masked);
  const [copied, setCopied] = useState(false);
  const display = masked && !revealed ? "•".repeat(Math.min(40, value.length || 8)) : value;

  return (
    <div className="flex items-center gap-2">
      <Input
        readOnly
        value={display}
        className={cn("flex-1", monospace && "font-mono text-xs")}
      />
      {masked && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setRevealed((v) => !v)}
          aria-label={revealed ? "Hide" : "Reveal"}
        >
          {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            toast.success("Copied");
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toast.error("Copy failed");
          }
        }}
        aria-label="Copy"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function VapiSetupPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState("");

  // Check states
  const [reachable, setReachable] = useState<CheckState>("idle");
  const [authState, setAuthState] = useState<CheckState>("idle");
  const [insertState, setInsertState] = useState<CheckState>("idle");
  const [testing, setTesting] = useState(false);
  const [badTesting, setBadTesting] = useState(false);
  const [rejectState, setRejectState] = useState<CheckState>("idle");
  const [lastTest, setLastTest] = useState<LastTest | null>(null);

  // Regen confirm dialog (with countdown)
  const [confirmRegenId, setConfirmRegenId] = useState<string | null>(null);
  const [regenCountdown, setRegenCountdown] = useState(0);

  // Vapi-side assistant ID hint (persisted local-only)
  const [vapiHint, setVapiHint] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setServerUrl(`${window.location.origin}/api/public/vapi-webhook`);
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const data = (await listAgents()) as Agent[];
      setAgents(data);
      setSelectedId((prev) => prev ?? data.find((a) => a.is_active)?.id ?? data[0]?.id ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load assistants");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selected = useMemo(
    () => agents.find((a) => a.id === selectedId) ?? null,
    [agents, selectedId],
  );

  // Restore lastTest + hint from localStorage when selection changes.
  useEffect(() => {
    if (!selected) return;
    try {
      const raw = localStorage.getItem(lastTestKey(selected.id));
      setLastTest(raw ? (JSON.parse(raw) as LastTest) : null);
      setVapiHint(localStorage.getItem(vapiHintKey(selected.id)) ?? "");
      // Reset transient check states for the newly selected assistant.
      setReachable("idle"); setAuthState("idle"); setInsertState("idle"); setRejectState("idle");
    } catch {
      setLastTest(null);
    }
  }, [selected?.id]);

  // Countdown for regenerate
  useEffect(() => {
    if (confirmRegenId === null) { setRegenCountdown(0); return; }
    setRegenCountdown(3);
    const i = setInterval(() => setRegenCountdown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(i);
  }, [confirmRegenId]);

  const runTest = async (useBadSecret: boolean) => {
    if (!selected) return;
    if (useBadSecret) setBadTesting(true); else setTesting(true);
    if (useBadSecret) setRejectState("pending");
    else { setReachable("pending"); setAuthState("pending"); setInsertState("pending"); }
    try {
      const res = await sendWebhookTest({ data: { agentRowId: selected.id, useBadSecret } });
      if (useBadSecret) {
        // We expect this to be rejected (401/403) — otherwise the secret check is broken.
        const rejected = !res.authOk;
        setRejectState(rejected ? "ok" : "fail");
        toast[rejected ? "success" : "error"](
          rejected ? "Bad secret correctly rejected" : "Bad secret was accepted — check your config",
        );
      } else {
        setReachable(res.status > 0 ? "ok" : "fail");
        setAuthState(res.authOk ? "ok" : "fail");
        setInsertState(res.insertOk ? "ok" : "fail");
        const lt: LastTest = {
          at: new Date().toISOString(),
          status: res.status,
          authOk: res.authOk,
          insertOk: res.insertOk,
          durationMs: res.duration_ms,
          message: res.message,
        };
        setLastTest(lt);
        try { localStorage.setItem(lastTestKey(selected.id), JSON.stringify(lt)); } catch { /* ignore */ }
        toast[res.insertOk ? "success" : "error"](
          res.insertOk ? `Test lead inserted (${res.duration_ms} ms)` : `Test failed: ${res.message}`,
        );
      }
    } catch (e) {
      if (useBadSecret) setRejectState("fail");
      else { setReachable("fail"); setAuthState("fail"); setInsertState("fail"); }
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      if (useBadSecret) setBadTesting(false); else setTesting(false);
    }
  };

  const handleRegenerate = async (rowId: string) => {
    try {
      await regenerateAgentSecret({ data: { id: rowId } });
      toast.success("Webhook secret regenerated");
      // Invalidate the last test result for this assistant.
      try { localStorage.removeItem(lastTestKey(rowId)); } catch { /* ignore */ }
      setLastTest(null);
      setReachable("idle"); setAuthState("idle"); setInsertState("idle"); setRejectState("idle");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Regeneration failed");
    }
  };

  // Readiness checklist
  const checklist = useMemo(() => {
    const haveAgent = Boolean(selected);
    const isActive = Boolean(selected?.is_active);
    const haveSecret = Boolean(selected?.webhook_secret);
    const recentMs = lastTest ? Date.now() - new Date(lastTest.at).getTime() : Infinity;
    const recentOk = Boolean(lastTest?.insertOk) && recentMs < 24 * 60 * 60 * 1000;
    return { haveAgent, isActive, haveSecret, recentOk };
  }, [selected, lastTest]);
  const allReady = Object.values(checklist).every(Boolean);

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <PlugZap className="h-6 w-6 text-primary" /> Vapi Setup
          </h1>
          <p className="text-sm text-muted-foreground">
            Connect your Vapi assistant in five quick steps. Verified end-to-end with a live test.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link to="/live-calls">
            <PhoneCall className="h-4 w-4" /> Live Calls
          </Link>
        </Button>
      </div>

      {loading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading assistants…</CardContent></Card>
      ) : agents.length === 0 ? (
        <Alert>
          <AlertTitle>No assistants yet</AlertTitle>
          <AlertDescription>
            Create one in <Link to="/settings" className="text-primary underline-offset-2 hover:underline">Settings → Assistants</Link> to get started.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/* Step 1: pick assistant */}
          <Step n={1} title="Choose assistant" icon={ShieldCheck}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={cn(
                    "text-left rounded-lg border px-3 py-2 transition-colors",
                    selectedId === a.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-accent/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{a.name}</span>
                    {a.is_active ? (
                      <Badge variant="outline" className="border-status-scheduled/30 bg-status-scheduled/10 text-status-scheduled">Active</Badge>
                    ) : (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono truncate">{a.agent_id}</div>
                </button>
              ))}
            </div>
          </Step>

          {selected && (
            <>
              {/* Step 2: server URL */}
              <Step n={2} title="Server URL" icon={Globe}>
                <Label className="text-xs text-muted-foreground">Paste this into Vapi → Assistant → Server URL</Label>
                <CopyField value={serverUrl} />
              </Step>

              {/* Step 3: webhook secret */}
              <Step n={3} title="Webhook secret" icon={KeyRound}>
                <Label className="text-xs text-muted-foreground">Paste into Vapi → Assistant → Server Secret (sent as <span className="font-mono">x-vapi-secret</span>)</Label>
                <CopyField value={selected.webhook_secret} masked />
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => setConfirmRegenId(selected.id)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Regenerate
                  </Button>
                </div>
              </Step>

              {/* Step 4: assistant id */}
              <Step n={4} title="Assistant ID" icon={Hash}>
                <Label className="text-xs text-muted-foreground">Send this as <span className="font-mono">agent_id</span> in your webhook payload</Label>
                <CopyField value={selected.agent_id} />
                <div className="space-y-1.5 pt-2">
                  <Label htmlFor="vapi-hint" className="text-xs text-muted-foreground">
                    Vapi-side assistant ID (optional — saved locally for your reference)
                  </Label>
                  <Input
                    id="vapi-hint"
                    placeholder="e.g. asst_xxxx from Vapi dashboard"
                    value={vapiHint}
                    onChange={(e) => {
                      setVapiHint(e.target.value);
                      try { localStorage.setItem(vapiHintKey(selected.id), e.target.value); } catch { /* ignore */ }
                    }}
                  />
                </div>
              </Step>

              {/* Step 5: test */}
              <Step n={5} title="Send test webhook" icon={Send}>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void runTest(false)} disabled={testing} className="gap-2">
                    {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send test
                  </Button>
                  <Button onClick={() => void runTest(true)} disabled={badTesting} variant="outline" className="gap-2">
                    {badTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Send with bad secret
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <StatusPill state={reachable} label="URL reachable" />
                  <StatusPill state={authState} label="Auth accepted" />
                  <StatusPill state={insertState} label="Lead inserted" />
                  <StatusPill state={rejectState} label="Bad secret rejected" />
                </div>
                {lastTest && (
                  <div className="text-xs text-muted-foreground pt-1">
                    Last test: HTTP {lastTest.status} · {lastTest.durationMs} ms · {new Date(lastTest.at).toLocaleString()}
                    {lastTest.message ? ` · ${lastTest.message}` : ""}
                  </div>
                )}
              </Step>

              {/* Step 6: ready */}
              <Card className={cn("border-2", allReady ? "border-status-scheduled/40" : "border-border")}>
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold flex items-center gap-2">
                      <CheckCircle2 className={cn("h-5 w-5", allReady ? "text-status-scheduled" : "text-muted-foreground")} />
                      Go-live checklist
                    </div>
                    {allReady && (
                      <Badge className="bg-status-scheduled/15 text-status-scheduled border-status-scheduled/30 border" variant="outline">
                        Ready
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-2">
                  <CheckRow ok={checklist.haveAgent} label="Assistant selected" />
                  <CheckRow ok={checklist.isActive} label="Assistant is active" />
                  <CheckRow ok={checklist.haveSecret} label="Webhook secret configured" />
                  <CheckRow ok={checklist.recentOk} label="Successful test in last 24 h" />
                  <div className="pt-2">
                    <Button asChild disabled={!allReady} className="gap-2">
                      <Link to="/live-calls">
                        <PhoneCall className="h-4 w-4" /> Open live calls
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      <AlertDialog open={confirmRegenId !== null} onOpenChange={(open) => { if (!open) setConfirmRegenId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate webhook secret?</AlertDialogTitle>
            <AlertDialogDescription>
              The current secret will be invalidated immediately. Any Vapi assistants still configured with the old value will fail until you paste the new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={regenCountdown > 0}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const id = confirmRegenId;
                setConfirmRegenId(null);
                if (id) void handleRegenerate(id);
              }}
            >
              {regenCountdown > 0 ? `Regenerate secret (${regenCountdown})` : "Regenerate secret"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function Step({
  n,
  title,
  icon: Icon,
  children,
}: {
  n: number;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="p-4 pb-2 flex-row items-center gap-3 space-y-0">
        <div className="h-8 w-8 rounded-full bg-primary/10 text-primary grid place-items-center text-sm font-semibold">
          {n}
        </div>
        <div className="flex items-center gap-2 font-semibold">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-2 space-y-2">{children}</CardContent>
    </Card>
  );
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-status-scheduled" />
      ) : (
        <XCircle className="h-4 w-4 text-muted-foreground" />
      )}
      <span className={ok ? "" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}