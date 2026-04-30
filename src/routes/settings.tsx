import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import AppShell from "@/components/leaseflow/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Copy, Check, RefreshCw, Eye, EyeOff } from "lucide-react";
import ConnectedAccounts from "@/components/leaseflow/ConnectedAccounts";
import { getWebhookSecret, regenerateWebhookSecret } from "@/server/webhook-secret.functions";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — LeaseFlow" }] }),
  component: SettingsPage,
});

type Profile = {
  id: string; full_name: string | null; email: string | null;
  is_subscribed: boolean; agent_id: string; stripe_customer_id: string | null;
};

function SettingsPage() {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);
  const [copiedAgent, setCopiedAgent] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [secretLoading, setSecretLoading] = useState(true);
  const [revealSecret, setRevealSecret] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

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

  useEffect(() => {
    if (!user) return;
    setSecretLoading(true);
    getWebhookSecret()
      .then((res) => setWebhookSecret(res.secret))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to load secret"))
      .finally(() => setSecretLoading(false));
  }, [user]);

  const regenerate = async () => {
    if (!confirm("Regenerate your webhook secret? Your current secret will stop working immediately and you'll need to update Vapi.")) return;
    setRegenerating(true);
    try {
      const res = await regenerateWebhookSecret();
      setWebhookSecret(res.secret);
      setRevealSecret(true);
      toast.success("New webhook secret generated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to regenerate secret");
    } finally {
      setRegenerating(false);
    }
  };

  const copySecret = async () => {
    if (!webhookSecret) return;
    await navigator.clipboard.writeText(webhookSecret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 1500);
  };

  const maskedSecret = webhookSecret
    ? `${webhookSecret.slice(0, 6)}${"•".repeat(28)}${webhookSecret.slice(-4)}`
    : "";

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
    // Without service role we can't delete the auth user from the client; remove their data and sign out.
    await supabase.from("leads").delete().eq("user_id", user.id);
    await supabase.from("profiles").delete().eq("id", user.id);
    await signOut();
    toast.success("Account data deleted. Contact support to fully remove your login.");
  };

  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/public/vapi-webhook` : "";

  const copy = async (text: string, which: "agent" | "url") => {
    await navigator.clipboard.writeText(text);
    if (which === "agent") { setCopiedAgent(true); setTimeout(() => setCopiedAgent(false), 1500); }
    else { setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 1500); }
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your profile, subscription, and Vapi integration.</p>
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

        {/* Subscription */}
        <section className="rounded-xl border border-border bg-surface p-5 space-y-3">
          <h2 className="font-medium">Subscription</h2>
          {profile?.is_subscribed ? (
            <div className="flex items-center justify-between">
              <span className="rounded-full border border-status-closed/30 bg-status-closed/15 text-status-closed px-3 py-1 text-xs">Active — Pro Plan</span>
              <Button variant="outline" disabled>Manage subscription</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">LeaseFlow Pro</div>
                <div className="text-sm text-muted-foreground">৳3,500/month · unlimited leads & Vapi capture</div>
              </div>
              <Button onClick={() => toast.info("Stripe checkout will be wired in the next step.")}>
                Upgrade to Pro
              </Button>
            </div>
          )}
        </section>

        <ConnectedAccounts />

        {/* Vapi */}
        <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <div>
            <h2 className="font-medium">Vapi integration</h2>
            <p className="text-sm text-muted-foreground">Wire your Vapi assistant to push every call into LeaseFlow.</p>
          </div>

          <div className="space-y-2">
            <Label>Your Agent ID</Label>
            <div className="flex gap-2">
              <Input readOnly value={profile?.agent_id ?? ""} className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={() => profile && copy(profile.agent_id, "agent")}>
                {copiedAgent ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Send this as <code className="font-mono">agent_id</code> in your webhook payload.</p>
          </div>

          <div className="space-y-2">
            <Label>Webhook URL</Label>
            <div className="flex gap-2">
              <Input readOnly value={webhookUrl} className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={() => copy(webhookUrl, "url")}>
                {copiedUrl ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">POST JSON. Add header <code className="font-mono">x-vapi-secret</code> matching the secret below.</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Webhook secret</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={regenerate}
                disabled={regenerating || secretLoading}
                className="gap-2 h-8"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? "animate-spin" : ""}`} />
                {regenerating ? "Regenerating…" : "Regenerate"}
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                readOnly
                value={secretLoading ? "Loading…" : revealSecret ? webhookSecret ?? "" : maskedSecret}
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setRevealSecret((v) => !v)}
                disabled={!webhookSecret}
                title={revealSecret ? "Hide" : "Reveal"}
              >
                {revealSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={copySecret}
                disabled={!webhookSecret}
                title="Copy"
              >
                {copiedSecret ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Treat this like a password. Regenerating it immediately invalidates the old one — update Vapi right after.
            </p>
          </div>
        </section>

        {/* Danger */}
        <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 space-y-3">
          <h2 className="font-medium text-destructive">Danger zone</h2>
          <p className="text-sm text-muted-foreground">Delete all your leads and profile data. This cannot be undone.</p>
          <Button variant="destructive" onClick={deleteAccount}>Delete account data</Button>
        </section>
      </div>
    </AppShell>
  );
}
