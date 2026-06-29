import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import logoMark from "@/assets/logo-mark.png";
import { MailCheck, Check, Circle, Loader2 } from "lucide-react";
import {
  resendVerificationEmail,
  getResendStatus,
} from "@/lib/email-resend.functions";

export const Route = createFileRoute("/verify-email")({
  head: () => ({ meta: [{ title: "Verify your email — LeaseFlow" }] }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [resending, setResending] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [maxPerWindow, setMaxPerWindow] = useState<number>(3);

  const loadStatus = async () => {
    try {
      const s = await getResendStatus();
      setRemaining(s.remaining);
      setMaxPerWindow(s.max);
    } catch {
      // ignore — likely not authed yet
    }
  };

  useEffect(() => {
    if (!authLoading && user) loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate({ to: "/login" });
      return;
    }
    if (user.email_confirmed_at) {
      navigate({ to: "/dashboard" });
    }
  }, [user, authLoading, navigate]);

  // Poll session so this page advances automatically once the user verifies in another tab.
  useEffect(() => {
    const id = setInterval(async () => {
      const { data } = await supabase.auth.refreshSession();
      if (data.session?.user.email_confirmed_at) {
        navigate({ to: "/dashboard" });
      }
    }, 5000);
    return () => clearInterval(id);
  }, [navigate]);

  const resend = async () => {
    if (!user?.email) return;
    setResending(true);
    try {
      const res = await resendVerificationEmail();
      if (res.alreadyConfirmed) {
        toast.success("Email already confirmed");
        navigate({ to: "/dashboard" });
        return;
      }
      setRemaining(res.remaining);
      toast.success(
        `Verification email sent${
          typeof res.remaining === "number"
            ? ` — ${res.remaining} resend${res.remaining === 1 ? "" : "s"} left this hour`
            : ""
        }`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to resend");
      void loadStatus();
    } finally {
      setResending(false);
    }
  };

  const isLoggedIn = Boolean(user);
  const isConfirmed = Boolean(user?.email_confirmed_at);
  const rateLimited = remaining !== null && remaining <= 0;

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 mb-8 justify-center">
          <img src={logoMark} alt="LeaseFlow" width={32} height={32} className="h-8 w-8" loading="lazy" />
          <span className="font-semibold text-lg tracking-tight">LeaseFlow</span>
        </Link>
        <div className="rounded-xl border border-border bg-surface p-6 md:p-8 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 grid place-items-center">
            <MailCheck className="h-6 w-6 text-primary" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Verify your email</h1>
          <p className="text-sm text-muted-foreground mt-2">
            We sent a confirmation link to{" "}
            <span className="text-foreground font-medium">{user?.email ?? "your inbox"}</span>.
            Click the link to activate your account.
          </p>

          <ul className="mt-6 space-y-2 text-left rounded-lg border border-border bg-background/50 p-4">
            <StatusRow
              done={isLoggedIn}
              loading={authLoading}
              label="Signed in"
              detail={user?.email ?? undefined}
            />
            <StatusRow
              done={isConfirmed}
              loading={authLoading}
              label="Email confirmed"
              detail={
                isConfirmed
                  ? "Verified"
                  : "Waiting for you to click the link in your inbox"
              }
            />
          </ul>

          <div className="mt-4 space-y-2">
            <Button
              onClick={resend}
              disabled={resending || rateLimited}
              className="w-full"
            >
              {resending
                ? "Sending..."
                : rateLimited
                ? "Resend limit reached — try later"
                : "Resend verification email"}
            </Button>
            {remaining !== null && (
              <p className="text-xs text-muted-foreground">
                {remaining} of {maxPerWindow} resends left this hour
              </p>
            )}
            <button
              onClick={async () => { await signOut(); navigate({ to: "/login" }); }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Use a different account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusRow({
  done,
  loading,
  label,
  detail,
}: {
  done: boolean;
  loading?: boolean;
  label: string;
  detail?: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={`mt-0.5 h-5 w-5 rounded-full grid place-items-center shrink-0 ${
          done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        }`}
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : done ? (
          <Check className="h-3 w-3" />
        ) : (
          <Circle className="h-2 w-2 fill-current" />
        )}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {detail && (
          <div className="text-xs text-muted-foreground truncate">{detail}</div>
        )}
      </div>
    </li>
  );
}
