import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import logoMark from "@/assets/logo-mark.png";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Log in — LeaseFlow" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && user) {
      navigate({ to: user.email_confirmed_at ? "/dashboard" : "/verify-email" });
    }
  }, [user, authLoading, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    if (!data.user?.email_confirmed_at) {
      toast.message("Please verify your email to continue");
      navigate({ to: "/verify-email" });
      return;
    }
    toast.success("Welcome back");
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 mb-8 justify-center">
          <img src={logoMark} alt="LeaseFlow" width={32} height={32} className="h-8 w-8" loading="lazy" />
          <span className="font-semibold text-lg tracking-tight">LeaseFlow</span>
        </Link>
        <div className="rounded-xl border border-border bg-surface p-6 md:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
          <p className="text-sm text-muted-foreground mt-1">Welcome back to your pipeline.</p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Log in"}
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground text-center">
            New here? <Link to="/signup" className="text-primary hover:underline">Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
