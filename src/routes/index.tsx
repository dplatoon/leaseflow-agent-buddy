import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ArrowRight, Phone, Sparkles, KanbanSquare } from "lucide-react";
import logoMark from "@/assets/logo-mark.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LeaseFlow — Rental CRM for Bangladesh agents" },
      { name: "description", content: "Capture, manage and follow up on rental leads automatically with AI voice calls." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate({ to: "/dashboard" });
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-5 md:px-12">
        <div className="flex items-center gap-2">
          <img src={logoMark} alt="LeaseFlow" width={32} height={32} className="h-8 w-8" />
          <span className="font-semibold text-lg tracking-tight">LeaseFlow</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login"><Button variant="ghost">Log in</Button></Link>
          <Link to="/signup"><Button>Get started</Button></Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 pt-16 pb-24 text-center md:pt-28">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary" /> AI voice + CRM for real estate
        </div>
        <h1 className="mt-6 text-4xl md:text-6xl font-semibold tracking-tight">
          Rental leads, captured <span className="text-primary">on autopilot.</span>
        </h1>
        <p className="mt-5 mx-auto max-w-2xl text-muted-foreground text-lg">
          LeaseFlow is the CRM built for Bangladeshi real-estate agents. Vapi answers your calls,
          extracts the lead, and drops it straight into your pipeline.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link to="/signup">
            <Button size="lg" className="gap-2">Start free <ArrowRight className="h-4 w-4" /></Button>
          </Link>
          <Link to="/login"><Button size="lg" variant="outline">I have an account</Button></Link>
        </div>

        <div className="mt-20 grid gap-4 md:grid-cols-3 text-left">
          {[
            { icon: Phone, title: "Vapi voice intake", body: "Every call becomes a structured lead, automatically." },
            { icon: KanbanSquare, title: "Kanban pipeline", body: "Drag leads through New → Contacted → Closed." },
            { icon: Sparkles, title: "Built for BDT", body: "Budget pills tuned for the Dhaka rental market." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-surface p-5">
              <f.icon className="h-5 w-5 text-primary" />
              <div className="mt-3 font-medium">{f.title}</div>
              <div className="mt-1 text-sm text-muted-foreground">{f.body}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
