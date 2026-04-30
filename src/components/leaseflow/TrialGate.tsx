import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Sparkles, Clock } from "lucide-react";

export function TrialBanner({ daysLeft }: { daysLeft: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-primary" />
        <span>
          <span className="font-medium">Free trial</span> — {daysLeft} {daysLeft === 1 ? "day" : "days"} left
        </span>
      </div>
      <Link to="/settings">
        <Button size="sm" variant="outline" className="border-primary/40 hover:bg-primary/15">
          Upgrade to Pro
        </Button>
      </Link>
    </div>
  );
}

export function TrialExpired() {
  return (
    <div className="grid place-items-center py-16">
      <div className="max-w-md rounded-xl border border-border bg-surface p-8 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-primary/15 grid place-items-center">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <h2 className="mt-4 text-xl font-semibold tracking-tight">Your free trial has ended</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Upgrade to LeaseFlow Pro to keep capturing leads, using the pipeline, and receiving Vapi calls.
        </p>
        <Link to="/settings" className="mt-6 inline-block">
          <Button size="lg">Upgrade — ৳3,500/month</Button>
        </Link>
      </div>
    </div>
  );
}