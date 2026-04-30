import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import logoMark from "@/assets/logo-mark.png";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Forgot password — LeaseFlow" },
      { name: "description", content: "Reset your LeaseFlow account password." },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    setSent(true);
    toast.success("Check your email for a reset link");
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 mb-8 justify-center">
          <img src={logoMark} alt="LeaseFlow" width={32} height={32} className="h-8 w-8" loading="lazy" />
          <span className="font-semibold text-lg tracking-tight">LeaseFlow</span>
        </Link>
        <div className="rounded-xl border border-border bg-surface p-6 md:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">Forgot your password?</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enter your email and we'll send you a link to reset it.
          </p>
          {sent ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-lg border border-border bg-background/50 p-4 text-sm">
                If an account exists for <span className="font-medium text-foreground">{email}</span>,
                a reset link is on its way. The link expires in 1 hour.
              </div>
              <Button variant="outline" className="w-full" onClick={() => navigate({ to: "/login" })}>
                Back to log in
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Sending..." : "Send reset link"}
              </Button>
              <p className="text-sm text-muted-foreground text-center">
                Remembered it?{" "}
                <Link to="/login" className="text-primary hover:underline">Log in</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
