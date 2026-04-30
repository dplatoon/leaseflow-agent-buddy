import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import logoMark from "@/assets/logo-mark.png";
import { MailCheck } from "lucide-react";

export const Route = createFileRoute("/verify-email")({
  head: () => ({ meta: [{ title: "Verify your email — LeaseFlow" }] }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [resending, setResending] = useState(false);

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
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: user.email,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    setResending(false);
    if (error) return toast.error(error.message);
    toast.success("Verification email sent");
  };

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
          <div className="mt-6 space-y-2">
            <Button onClick={resend} disabled={resending} className="w-full">
              {resending ? "Sending..." : "Resend verification email"}
            </Button>
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
