import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Link2, Link2Off, Mail } from "lucide-react";
import type { UserIdentity } from "@supabase/supabase-js";

const PROVIDER_META: Record<string, { label: string; icon: JSX.Element }> = {
  google: {
    label: "Google",
    icon: (
      <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.9 6.3 29.2 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.1l6.6 4.8C14.7 15.1 19 12.5 24 12.5c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.9 6.3 29.2 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.1z" />
        <path fill="#4CAF50" d="M24 43.5c5.1 0 9.8-1.7 13.4-4.7l-6.2-5.2c-2 1.4-4.5 2.4-7.2 2.4-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.6 39 16.2 43.5 24 43.5z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2c-.4.4 6.6-4.8 6.6-14.8 0-1.2-.1-2.3-.4-3.5z" />
      </svg>
    ),
  },
  email: { label: "Email & Password", icon: <Mail className="h-4 w-4" /> },
};

export default function ConnectedAccounts() {
  const [identities, setIdentities] = useState<UserIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.getUserIdentities();
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setIdentities(data?.identities ?? []);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const linkGoogle = async () => {
    setBusy("link-google");
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/settings` },
    });
    if (error) {
      setBusy(null);
      toast.error(error.message);
    }
    // On success the browser is redirected to Google; no further action needed.
  };

  const unlink = async (identity: UserIdentity) => {
    if (identities.length <= 1) {
      toast.error("You must keep at least one sign-in method.");
      return;
    }
    if (!confirm(`Disconnect ${PROVIDER_META[identity.provider]?.label ?? identity.provider} from your account?`)) return;
    setBusy(`unlink-${identity.identity_id}`);
    const { error } = await supabase.auth.unlinkIdentity(identity);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Account disconnected");
    refresh();
  };

  const hasGoogle = identities.some((i) => i.provider === "google");

  return (
    <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
      <div>
        <h2 className="font-medium">Connected accounts</h2>
        <p className="text-sm text-muted-foreground">
          Link multiple sign-in methods to the same LeaseFlow account. Linking by matching email keeps everything on one profile.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {identities.map((identity) => {
            const meta = PROVIDER_META[identity.provider] ?? {
              label: identity.provider,
              icon: <Link2 className="h-4 w-4" />,
            };
            const email = (identity.identity_data?.email as string | undefined) ?? "—";
            const canUnlink = identities.length > 1 && identity.provider !== "email";
            return (
              <li key={identity.identity_id} className="flex items-center justify-between gap-3 p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="grid h-8 w-8 place-items-center rounded-md border border-border bg-background">
                    {meta.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{meta.label}</div>
                    <div className="text-xs text-muted-foreground truncate">{email}</div>
                  </div>
                </div>
                {canUnlink ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => unlink(identity)}
                    disabled={busy === `unlink-${identity.identity_id}`}
                    className="gap-2"
                  >
                    <Link2Off className="h-3.5 w-3.5" />
                    Disconnect
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Primary</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!hasGoogle && (
        <div className="flex items-center justify-between rounded-lg border border-dashed border-border p-3">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-md border border-border bg-background">
              {PROVIDER_META.google.icon}
            </div>
            <div>
              <div className="text-sm font-medium">Google</div>
              <div className="text-xs text-muted-foreground">Add one-click sign in with Google.</div>
            </div>
          </div>
          <Button size="sm" onClick={linkGoogle} disabled={busy === "link-google"} className="gap-2">
            <Link2 className="h-3.5 w-3.5" />
            {busy === "link-google" ? "Connecting…" : "Connect"}
          </Button>
        </div>
      )}
    </section>
  );
}
