import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { fetchRules, saveRules, type ReminderRules } from "@/lib/reminders";
import { STATUSES, type Status } from "@/lib/leaseflow";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Bell } from "lucide-react";

const FIELD_BY_STATUS: Record<Status, keyof Omit<ReminderRules, "user_id" | "enabled">> = {
  New: "new_hours",
  Contacted: "contacted_hours",
  Scheduled: "scheduled_hours",
  Closed: "closed_hours",
  Lost: "lost_hours",
};

const HELP: Record<Status, string> = {
  New: "When a lead arrives.",
  Contacted: "After you mark them contacted.",
  Scheduled: "After scheduling a viewing.",
  Closed: "Usually leave blank.",
  Lost: "Usually leave blank.",
};

export default function ReminderRulesSection() {
  const { user } = useAuth();
  const [rules, setRules] = useState<ReminderRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        setRules(await fetchRules(user.id));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load rules");
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  if (!user) return null;

  const setHours = (status: Status, raw: string) => {
    if (!rules) return;
    const n = raw.trim() === "" ? null : Math.max(0, Math.min(24 * 30, Number(raw)));
    if (raw.trim() !== "" && Number.isNaN(n as number)) return;
    setRules({ ...rules, [FIELD_BY_STATUS[status]]: n } as ReminderRules);
  };

  const onSave = async () => {
    if (!rules) return;
    setSaving(true);
    try {
      await saveRules(rules);
      toast.success("Reminder rules saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium flex items-center gap-2"><Bell className="h-4 w-4" /> Follow-up reminder rules</h2>
          <p className="text-sm text-muted-foreground">
            When a lead enters a status, a follow-up reminder is auto-created the set number of hours later.
            Leave blank to skip auto-reminders for that status. Changing a lead's status auto-completes the prior
            reminder and starts a new one.
          </p>
        </div>
        {rules && (
          <div className="flex items-center gap-2 shrink-0">
            <Label htmlFor="rules-enabled" className="text-xs text-muted-foreground">Enabled</Label>
            <Switch
              id="rules-enabled"
              checked={rules.enabled}
              onCheckedChange={(v) => setRules({ ...rules, enabled: v })}
            />
          </div>
        )}
      </div>

      {loading || !rules ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {STATUSES.map((s) => {
              const v = rules[FIELD_BY_STATUS[s]];
              return (
                <div key={s} className="space-y-1.5">
                  <Label className="text-sm">{s}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={720}
                      placeholder="off"
                      value={v ?? ""}
                      onChange={(e) => setHours(s, e.target.value)}
                      className="h-9"
                      disabled={!rules.enabled}
                    />
                    <span className="text-xs text-muted-foreground">hours</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{HELP[s]}</p>
                </div>
              );
            })}
          </div>
          <Button onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save rules"}</Button>
        </>
      )}
    </section>
  );
}