import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  fetchTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  TEMPLATE_VARS,
  type MessageChannel,
  type MessageTemplate,
} from "@/lib/templates";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { MessageSquare, Plus, Save, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

const STARTER: { name: string; body: string }[] = [
  {
    name: "Initial reach-out",
    body: "Hi {{first_name}}, this is {{agent_name}}. Saw your inquiry about {{location}} ({{budget}}). I have a few good options — when's a good time to chat?",
  },
  {
    name: "Viewing follow-up",
    body: "Hi {{first_name}}, just confirming the viewing for {{location}}. Let me know if anything changed or if you have questions before then. — {{agent_name}}",
  },
  {
    name: "Re-engage",
    body: "Hey {{first_name}}, still looking for a {{property_type}} in {{location}}? I just got a new listing in your range. Want me to send details?",
  },
];

export default function MessageTemplatesSection() {
  const { user } = useAuth();
  const [items, setItems] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [draft, setDraft] = useState({ name: "", body: "", channel: "whatsapp" as MessageChannel, isDefault: false });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setItems(await fetchTemplates()); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed to load templates"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const startNew = () => {
    setEditing(null);
    setDraft({ name: "", body: "Hi {{first_name}}, ", channel: "whatsapp", isDefault: false });
  };
  const startEdit = (t: MessageTemplate) => {
    setEditing(t);
    setDraft({ name: t.name, body: t.body, channel: t.channel, isDefault: t.is_default });
  };
  const cancelEdit = () => { setEditing(null); setDraft({ name: "", body: "", channel: "whatsapp", isDefault: false }); };

  const insertVar = (k: string) => {
    setDraft((d) => ({ ...d, body: d.body + `{{${k}}}` }));
  };

  const onSave = async () => {
    if (!user) return;
    if (!draft.name.trim() || !draft.body.trim()) { toast.error("Name and body required"); return; }
    setBusy(true);
    try {
      if (editing) {
        await updateTemplate({ ...editing, name: draft.name, body: draft.body, channel: draft.channel, is_default: draft.isDefault });
        toast.success("Template updated");
      } else {
        await createTemplate({ userId: user.id, name: draft.name, body: draft.body, channel: draft.channel, isDefault: draft.isDefault });
        toast.success("Template created");
      }
      cancelEdit();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally { setBusy(false); }
  };

  const onDelete = async (id: string) => {
    if (!confirm("Delete this template?")) return;
    try { await deleteTemplate(id); await load(); toast.success("Deleted"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed to delete"); }
  };

  const seedStarters = async () => {
    if (!user) return;
    if (!confirm("Add 3 starter templates?")) return;
    setBusy(true);
    try {
      for (let i = 0; i < STARTER.length; i++) {
        const s = STARTER[i];
        // eslint-disable-next-line no-await-in-loop
        await createTemplate({ userId: user.id, name: s.name, body: s.body, channel: "whatsapp", isDefault: i === 0 && items.length === 0 });
      }
      await load();
      toast.success("Starter templates added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Message templates</h2>
          <p className="text-sm text-muted-foreground">
            Reusable WhatsApp / SMS messages with <code className="text-xs">{"{{variables}}"}</code>. Use them from any lead.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {items.length === 0 && (
            <Button variant="outline" size="sm" onClick={seedStarters} disabled={busy}>Add starter set</Button>
          )}
          <Button size="sm" onClick={startNew} className="gap-1"><Plus className="h-3.5 w-3.5" /> New</Button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : items.length === 0 && !editing && draft.name === "" ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground text-center">
          No templates yet. Create one or seed the starter set.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-background">
          {items.map((t) => (
            <li key={t.id} className="px-3 py-2.5 flex items-start gap-3">
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{t.name}</span>
                  <span className="text-[10px] uppercase rounded bg-muted px-1 py-0.5 text-muted-foreground">{t.channel}</span>
                  {t.is_default && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-primary/15 text-primary px-1 py-0.5 text-[10px]">
                      <Star className="h-2.5 w-2.5" /> default
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">{t.body}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => startEdit(t)}>Edit</Button>
                <Button variant="ghost" size="sm" className="h-7 text-destructive hover:text-destructive" onClick={() => onDelete(t.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(editing || draft.name !== "" || (items.length === 0 && !loading && draft.body !== "")) && (
        <div className="rounded-lg border border-border bg-background p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Initial reach-out" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Channel</Label>
              <Select value={draft.channel} onValueChange={(v) => setDraft({ ...draft, channel: v as MessageChannel })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Body</Label>
            <Textarea
              rows={5}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              placeholder="Hi {{first_name}}, ..."
            />
            <div className="flex flex-wrap gap-1 pt-1">
              <span className="text-[11px] text-muted-foreground mr-1">Insert:</span>
              {TEMPLATE_VARS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => insertVar(v.key)}
                  title={v.desc}
                  className="text-[10px] rounded border border-border px-1.5 py-0.5 hover:bg-accent transition-colors"
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={draft.isDefault}
              onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })}
              className="h-3 w-3 rounded border-border"
            />
            Make this the default for {draft.channel === "sms" ? "SMS" : "WhatsApp"}
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={cancelEdit} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={onSave} disabled={busy} className={cn("gap-1")}>
              <Save className="h-3.5 w-3.5" /> {editing ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}