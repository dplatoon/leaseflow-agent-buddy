import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Users, KanbanSquare, Settings, LogOut, Plus, Menu, Search, Webhook, Bell, PhoneCall, PlugZap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import NewLeadModal from "./NewLeadModal";
import logoMark from "@/assets/logo-mark.png";
import { supabase } from "@/integrations/supabase/client";
import { useDueReminderToasts } from "@/hooks/useDueReminderToasts";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { to: "/live-calls", label: "Live Calls", icon: PhoneCall },
  { to: "/reminders", label: "Reminders", icon: Bell },
  { to: "/vapi-setup", label: "Vapi Setup", icon: PlugZap },
  { to: "/webhook-events", label: "Webhook Events", icon: Webhook },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export default function AppShell({
  children,
  showSearch = false,
  searchValue,
  onSearchChange,
}: {
  children: React.ReactNode;
  showSearch?: boolean;
  searchValue?: string;
  onSearchChange?: (v: string) => void;
}) {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [dueCount, setDueCount] = useState(0);

  // Surface in-app toasts when reminders become due.
  useDueReminderToasts();

  // Poll due-reminder count for the sidebar badge
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      const { count } = await supabase
        .from("lead_reminders" as never)
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lte("due_at", new Date().toISOString());
      if (!cancelled) setDueCount(count ?? 0);
    };
    void load();
    const interval = setInterval(load, 60_000);
    const onChange = () => load();
    window.addEventListener("leaseflow:reminders-changed", onChange);
    window.addEventListener("leaseflow:lead-created", onChange);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("leaseflow:reminders-changed", onChange);
      window.removeEventListener("leaseflow:lead-created", onChange);
    };
  }, [user]);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
    else if (!loading && user && !user.email_confirmed_at) navigate({ to: "/verify-email" });
  }, [user, loading, navigate]);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  if (loading || !user) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  }

  const Sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-sidebar">
      <div className="px-5 py-5 flex items-center gap-2">
        <img src={logoMark} alt="LeaseFlow" width={32} height={32} className="h-8 w-8" loading="lazy" />
        <span className="font-semibold tracking-tight">LeaseFlow</span>
      </div>
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          const isReminders = item.to === "/reminders";
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {isReminders && dueCount > 0 && (
                <span className="rounded-full bg-status-lost/20 text-status-lost border border-status-lost/30 px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
                  {dueCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border px-4 py-4">
        <div className="text-xs text-muted-foreground truncate" title={user.email ?? ""}>{user.email}</div>
        <button
          onClick={async () => { await signOut(); navigate({ to: "/login" }); }}
          className="mt-2 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <LogOut className="h-4 w-4" /> Logout
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <div className="hidden md:block">{Sidebar}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0">{Sidebar}</div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border flex items-center gap-3 px-4 md:px-6">
          <button className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          {showSearch ? (
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or phone…"
                value={searchValue ?? ""}
                onChange={(e) => onSearchChange?.(e.target.value)}
                className="pl-9 bg-surface"
              />
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <Button
            onClick={() => setLeadOpen(true)}
            className="gap-2"
          >
            <Plus className="h-4 w-4" /> New Lead
          </Button>
        </header>
        <main className="flex-1 p-4 md:p-6 overflow-x-hidden space-y-4">
          {children}
        </main>
      </div>

      <NewLeadModal open={leadOpen} onOpenChange={setLeadOpen} />
    </div>
  );
}
