import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/leaseflow/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Copy,
  Check,
  RefreshCw,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Power,
  Send,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  PencilLine,
  Link as LinkIcon,
} from "lucide-react";
import ConnectedAccounts from "@/components/leaseflow/ConnectedAccounts";
import ReminderRulesSection from "@/components/leaseflow/ReminderRulesSection";
import MessageTemplatesSection from "@/components/leaseflow/MessageTemplatesSection";
import {
  listAgents,
  createAgent,
  renameAgent,
  setAgentActive,
  regenerateAgentSecret,
  deleteAgent,
} from "@/server/agents.functions";
import { sendWebhookTest } from "@/server/webhook-test.functions";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — LeaseFlow" }] }),
  component: SettingsPage,
});

type Profile = {
  id: string; full_name: string | null; email: string | null;
  agent_id: string;
};

type Agent = {
  id: string;
  name: string;
  agent_id: string;
  webhook_secret: string;
  is_active: boolean;
  created_at: string;
};

type TestResult = {
  ok: boolean;
  status: number;
  authOk: boolean;
  insertOk: boolean;
  leadId: string | null;
  message: string;
  duration_ms: number;
  url: string;
};

type RecentEvent = {
  id: string;
  request_id: string;
  status: string;
  stage: string;
  http_status: number;
  agent_id: string | null;
  error_message: string | null;
  created_at: string;
};

function SettingsPage() {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);

  // Multi-agent state
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [newAgentName, setNewAgentName] = useState("");
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, string | null>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [confirmRegenId, setConfirmRegenId] = useState<string | null>(null);

  // Recent webhook events
  const [events, setEvents] = useState<RecentEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (data) {
        setProfile(data as Profile);
        setFullName(data.full_name ?? "");
      }
    })();
  }, [user]);

  const loadAgents = useCallback(async () => {
    if (!user) return;
    setAgentsLoading(true);
    try {
      const res = await listAgents();
      setAgents(res.agents as Agent[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load agents");
    } finally {
      setAgentsLoading(false);
    }
  }, [user]);

  const loadEvents = useCallback(async () => {
    if (!user) return;
    setEventsLoading(true);
    const { data, error } = await supabase
      .from("webhook_logs" as never)
      .select("id, request_id, status, stage, http_status, agent_id, error_message, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) {
      toast.error(error.message);
      setEvents([]);
    } else {
      setEvents((data ?? []) as unknown as RecentEvent[]);
    }
    setEventsLoading(false);
  }, [user]);

  useEffect(() => {
    void loadAgents();
    void loadEvents();
  }, [loadAgents, loadEvents]);

  const mask = (s: string | null | undefined) => {
    const v = s ?? "";
    return v.length > 12 ? `${v.slice(0, 6)}${"•".repeat(24)}${v.slice(-4)}` : "•".repeat(v.length);
  };

  const copyText = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };

  const handleCreateAgent = async () => {
    const name = newAgentName.trim();
    if (!name) return;
    setCreatingAgent(true);
    try {
      const res = await createAgent({ data: { name } });
      setAgents((prev) => [...prev, res.agent as Agent]);
      setNewAgentName("");
      toast.success(`Created “${name}”`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create agent");
    } finally {
      setCreatingAgent(false);
    }
  };

  const handleRename = async (id: string) => {
    const next = (editing[id] ?? "").trim();
    if (!next) return;
    setBusy((b) => ({ ...b, [id]: "rename" }));
    try {
      await renameAgent({ data: { id, name: next } });
      setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, name: next } : a)));
      setEditing((e) => {
        const { [id]: _omit, ...rest } = e;
        return rest;
      });
      toast.success("Renamed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename");
    } finally {
      setBusy((b) => ({ ...b, [id]: null }));
    }
  };

  const handleToggleActive = async (a: Agent) => {
    setBusy((b) => ({ ...b, [a.id]: "toggle" }));
    try {
      await setAgentActive({ data: { id: a.id, is_active: !a.is_active } });
      setAgents((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_active: !a.is_active } : x)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to toggle");
    } finally {
      setBusy((b) => ({ ...b, [a.id]: null }));
    }
  };

  const handleRegenerate = async (id: string) => {
    setBusy((b) => ({ ...b, [id]: "regen" }));
    try {
      const res = await regenerateAgentSecret({ data: { id } });
      setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, webhook_secret: res.secret } : a)));
      setReveal((r) => ({ ...r, [id]: true }));
      toast.success("New secret generated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to regenerate");
    } finally {
      setBusy((b) => ({ ...b, [id]: null }));
    }
  };

  const handleDelete = async (a: Agent) => {
    if (!confirm(`Delete agent “${a.name}”? Its webhook URL will stop accepting calls.`)) return;
    setBusy((b) => ({ ...b, [a.id]: "delete" }));
    try {
      await deleteAgent({ data: { id: a.id } });
      setAgents((prev) => prev.filter((x) => x.id !== a.id));
      setTestResults((t) => {
        const { [a.id]: _omit, ...rest } = t;
        return rest;
      });
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setBusy((b) => ({ ...b, [a.id]: null }));
    }
  };

  const handleTest = async (a: Agent) => {
    setTesting((t) => ({ ...t, [a.id]: true }));
    try {
      const res = await sendWebhookTest({ data: { agentRowId: a.id } });
      setTestResults((prev) => ({
        ...prev,
        [a.id]: {
          ok: res.ok,
          status: res.status,
          authOk: res.authOk,
          insertOk: res.insertOk,
          leadId: res.leadId,
          message: res.message,
          duration_ms: res.duration_ms,
          url: res.url,
        },
      }));
      if (res.ok) toast.success("Test lead inserted");
      else toast.error(res.message || "Webhook test failed");
      void loadEvents();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting((t) => ({ ...t, [a.id]: false }));
    }
  };

  const saveName = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
  };

  const deleteAccount = async () => {
    if (!user) return;
    if (!confirm("Permanently delete your account and all leads? This cannot be undone.")) return;
    await supabase.from("leads").delete().eq("user_id", user.id);
    await supabase.from("profiles").delete().eq("id", user.id);
    await signOut();
    toast.success("Account data deleted. Contact support to fully remove your login.");
  };

  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/public/vapi-webhook` : "";

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your profile and Vapi integration.</p>
        </div>

        {/* Profile */}
        <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <h2 className="font-medium">Profile</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Full name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={profile?.email ?? user?.email ?? ""} disabled />
            </div>
          </div>
          <Button onClick={saveName} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
        </section>

        <ConnectedAccounts />

        {/* Vapi assistants — multi-agent */}
        <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-medium">Vapi assistants</h2>
              <p className="text-sm text-muted-foreground">
                Each assistant gets its own webhook URL and secret, so different Vapi agents can feed the same leads pipeline independently.
              </p>
            </div>
          </div>

          <div className="rounded-md border border-dashed border-border bg-background/40 p-3 text-xs space-y-1">
            <div className="text-muted-foreground">Shared endpoint (all assistants):</div>
            <div className="flex gap-2 items-center">
              <code className="font-mono text-[11px] break-all">{webhookUrl}</code>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copyText(webhookUrl, "endpoint")}>
                {copied === "endpoint" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <div className="text-muted-foreground pt-1">
              POST JSON with header <code className="font-mono">x-vapi-secret</code> = the assistant's secret, and include its <code className="font-mono">agent_id</code> in the body.
            </div>
          </div>

          {/* Add new agent */}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateAgent();
            }}
          >
            <Input
              placeholder="New assistant name (e.g. Banani sales bot)"
              value={newAgentName}
              onChange={(e) => setNewAgentName(e.target.value)}
              maxLength={80}
            />
            <Button type="submit" disabled={creatingAgent || !newAgentName.trim()} className="gap-2 shrink-0">
              <Plus className="h-4 w-4" />
              {creatingAgent ? "Adding…" : "Add assistant"}
            </Button>
          </form>

          {agentsLoading ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Loading assistants…</div>
          ) : agents.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No assistants yet. Add one above to generate its webhook credentials.
            </div>
          ) : (
            <ul className="space-y-3">
              {agents.map((a) => {
                const tr = testResults[a.id];
                const isEditing = editing[a.id] !== undefined;
                const missingAgentId = !a.agent_id || a.agent_id.trim() === "";
                const missingSecret = !a.webhook_secret || a.webhook_secret.trim() === "";
                const hasCredentialIssue = missingAgentId || missingSecret;
                return (
                  <li
                    key={a.id}
                    className={cn(
                      "rounded-lg border bg-card p-4 space-y-3",
                      a.is_active ? "border-border" : "border-border/50 opacity-70",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="flex gap-2">
                            <Input
                              autoFocus
                              value={editing[a.id]}
                              onChange={(e) => setEditing((s) => ({ ...s, [a.id]: e.target.value }))}
                              maxLength={80}
                              className="h-8"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void handleRename(a.id);
                                if (e.key === "Escape")
                                  setEditing((s) => {
                                    const { [a.id]: _o, ...rest } = s;
                                    return rest;
                                  });
                              }}
                            />
                            <Button size="sm" onClick={() => handleRename(a.id)} disabled={busy[a.id] === "rename"}>
                              Save
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{a.name}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => setEditing((s) => ({ ...s, [a.id]: a.name }))}
                            >
                              <PencilLine className="h-3.5 w-3.5" />
                            </Button>
                            {a.is_active ? (
                              <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                                Active
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
                                Disabled
                              </Badge>
                            )}
                          </div>
                        )}
                        <div className="text-[11px] text-muted-foreground mt-1">
                          Created {format(new Date(a.created_at), "MMM d, yyyy")}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          title={a.is_active ? "Disable" : "Enable"}
                          onClick={() => handleToggleActive(a)}
                          disabled={busy[a.id] === "toggle"}
                        >
                          <Power className={cn("h-4 w-4", a.is_active ? "text-emerald-400" : "text-muted-foreground")} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete"
                          onClick={() => handleDelete(a)}
                          disabled={busy[a.id] === "delete"}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {hasCredentialIssue && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Missing webhook credentials</AlertTitle>
                        <AlertDescription>
                          {missingAgentId && missingSecret
                            ? "This assistant has no agent ID or webhook secret. Regenerate the secret and contact support if the agent ID stays empty — the webhook cannot accept calls until both are set."
                            : missingAgentId
                              ? "This assistant has no agent ID. The webhook cannot route incoming calls until an agent ID is assigned."
                              : "This assistant has no webhook secret. Click Regenerate to create one before connecting Vapi."}
                        </AlertDescription>
                        {missingSecret && (
                          <div className="mt-3">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="gap-1.5 bg-background"
                              onClick={() => setConfirmRegenId(a.id)}
                              disabled={busy[a.id] === "regen"}
                            >
                              <RefreshCw className={cn("h-3.5 w-3.5", busy[a.id] === "regen" && "animate-spin")} />
                              {busy[a.id] === "regen" ? "Regenerating…" : "Regenerate secret"}
                            </Button>
                          </div>
                        )}
                      </Alert>
                    )}

                    {/* Agent ID */}
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Agent ID (send as <code className="font-mono">agent_id</code>)</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={a.agent_id ?? ""}
                          placeholder="No agent ID assigned"
                          aria-invalid={missingAgentId}
                          className={cn(
                            "font-mono text-xs h-9",
                            missingAgentId && "border-destructive focus-visible:ring-destructive",
                          )}
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          disabled={missingAgentId}
                          onClick={() => {
                            if (missingAgentId) {
                              toast.error("No agent ID to copy");
                              return;
                            }
                            void copyText(a.agent_id, `aid-${a.id}`);
                          }}
                        >
                          {copied === `aid-${a.id}` ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      {missingAgentId && (
                        <p className="text-[11px] text-destructive">Agent ID is missing — incoming webhooks will be rejected.</p>
                      )}
                    </div>

                    {/* Webhook secret */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-muted-foreground">Webhook secret (header <code className="font-mono">x-vapi-secret</code>)</Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5"
                          onClick={() => setConfirmRegenId(a.id)}
                          disabled={busy[a.id] === "regen"}
                        >
                          <RefreshCw className={cn("h-3.5 w-3.5", busy[a.id] === "regen" && "animate-spin")} />
                          {busy[a.id] === "regen" ? "Regenerating…" : "Regenerate"}
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={reveal[a.id] ? (a.webhook_secret ?? "") : mask(a.webhook_secret)}
                          placeholder="No secret generated"
                          aria-invalid={missingSecret}
                          className={cn(
                            "font-mono text-xs h-9",
                            missingSecret && "border-destructive focus-visible:ring-destructive",
                          )}
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          disabled={missingSecret}
                          onClick={() => setReveal((r) => ({ ...r, [a.id]: !r[a.id] }))}
                        >
                          {reveal[a.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          disabled={missingSecret}
                          onClick={() => {
                            if (missingSecret) {
                              toast.error("No webhook secret to copy");
                              return;
                            }
                            void copyText(a.webhook_secret, `sec-${a.id}`);
                          }}
                        >
                          {copied === `sec-${a.id}` ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      {missingSecret && (
                        <p className="text-[11px] text-destructive">Webhook secret is missing — click Regenerate to create one.</p>
                      )}
                    </div>

                    {/* Test webhook */}
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <p className="text-xs text-muted-foreground">
                        Send a synthetic Vapi payload to verify auth + lead insertion end-to-end.
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-2 shrink-0"
                        disabled={testing[a.id] || !a.is_active || hasCredentialIssue}
                        title={hasCredentialIssue ? "Fix missing credentials before testing" : undefined}
                        onClick={() => {
                          if (hasCredentialIssue) {
                            toast.error("Fix missing credentials before sending a test webhook");
                            return;
                          }
                          void handleTest(a);
                        }}
                      >
                        {testing[a.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {testing[a.id] ? "Testing…" : "Send test webhook"}
                      </Button>
                    </div>

                    {tr && (
                      <div
                        className={cn(
                          "rounded-md border p-3 text-xs space-y-2",
                          tr.ok
                            ? "border-emerald-500/30 bg-emerald-500/10"
                            : "border-destructive/30 bg-destructive/10",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {tr.ok ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-destructive" />
                          )}
                          <span className="font-medium">
                            {tr.ok ? "Webhook test succeeded" : "Webhook test failed"}
                          </span>
                          <span className="ml-auto text-muted-foreground tabular-nums">
                            HTTP {tr.status} · {tr.duration_ms}ms
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <CheckRow label="Authentication" ok={tr.authOk} />
                          <CheckRow label="Lead inserted" ok={tr.insertOk} />
                        </div>
                        {tr.leadId && (
                          <div className="text-muted-foreground">
                            Lead ID: <code className="font-mono">{tr.leadId}</code>
                          </div>
                        )}
                        {!tr.ok && tr.message && (
                          <div className="text-destructive break-words">{tr.message}</div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Recent webhook events */}
        <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-medium">Recent webhook events</h2>
              <p className="text-sm text-muted-foreground">
                Latest 10 attempts hitting your endpoint. Use this to spot auth failures or invalid payloads quickly.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="ghost" size="sm" className="gap-2" onClick={() => loadEvents()}>
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
              <Button asChild variant="outline" size="sm" className="gap-2">
                <Link to="/webhook-logs">
                  <LinkIcon className="h-3.5 w-3.5" /> View all
                </Link>
              </Button>
            </div>
          </div>

          {eventsLoading ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Loading events…</div>
          ) : events.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No webhook events yet. Send a test from any assistant above to see one here.
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border overflow-hidden">
              {events.map((ev) => (
                <li key={ev.id} className="px-3 py-2.5 text-sm flex items-center gap-3">
                  <div className="text-xs text-muted-foreground tabular-nums w-32 shrink-0">
                    {format(new Date(ev.created_at), "MMM d, HH:mm:ss")}
                  </div>
                  <Badge variant="outline" className={cn("capitalize shrink-0", statusBadgeClass(ev.status))}>
                    {ev.status}
                  </Badge>
                  <div className="text-xs text-muted-foreground tabular-nums w-12 shrink-0">
                    {ev.http_status}
                  </div>
                  <div className="text-xs font-mono text-muted-foreground truncate flex-1 min-w-0">
                    {ev.agent_id ?? "—"}
                  </div>
                  <div className="text-xs text-muted-foreground truncate hidden sm:block w-40">
                    {ev.error_message ?? ev.stage}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ReminderRulesSection />

        <MessageTemplatesSection />

        {/* Danger */}
        <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 space-y-3">
          <h2 className="font-medium text-destructive">Danger zone</h2>
          <p className="text-sm text-muted-foreground">Delete all your leads and profile data. This cannot be undone.</p>
          <Button variant="destructive" onClick={deleteAccount}>Delete account data</Button>
        </section>
      </div>

      <AlertDialog open={confirmRegenId !== null} onOpenChange={(open) => { if (!open) setConfirmRegenId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate webhook secret?</AlertDialogTitle>
            <AlertDialogDescription>
              The current secret will stop working immediately. Any Vapi assistant or integration still using the old secret will be rejected until you update it with the new value.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const id = confirmRegenId;
                setConfirmRegenId(null);
                if (id) void handleRegenerate(id);
              }}
            >
              Regenerate secret
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function CheckRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-destructive" />
      )}
      <span className={ok ? "text-foreground" : "text-destructive"}>{label}</span>
    </div>
  );
}

function statusBadgeClass(status: string) {
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
