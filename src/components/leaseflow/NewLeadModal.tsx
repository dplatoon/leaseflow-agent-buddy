import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BUDGETS, PROPERTY_TYPES, SOURCES, URGENCIES } from "@/lib/leaseflow";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const sourcePills = SOURCES.filter((s) => s !== "Manual");

export default function NewLeadModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: () => void;
}) {
  const { user } = useAuth();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [budget, setBudget] = useState<string>("");
  const [propertyType, setPropertyType] = useState<string>("");
  const [urgency, setUrgency] = useState<string>("");
  const [source, setSource] = useState<string>("Manual");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setFullName(""); setPhone(""); setLocation(""); setBudget("");
    setPropertyType(""); setUrgency(""); setSource("Manual"); setNotes("");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("leads").insert({
      user_id: user.id,
      full_name: fullName.trim(),
      phone: phone.trim() || null,
      location: location.trim() || null,
      budget: budget || null,
      property_type: propertyType || null,
      urgency: urgency || null,
      source: source || "Manual",
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Lead saved — ${fullName}`);
    reset();
    onOpenChange(false);
    onCreated?.();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("leaseflow:lead-created"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="bg-surface border-border max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New lead</DialogTitle>
          <DialogDescription>Capture a lead manually. Vapi-sourced leads come in automatically.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ln">Full name *</Label>
              <Input id="ln" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lp">Phone *</Label>
              <Input id="lp" required value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ll">Location *</Label>
            <Input id="ll" required placeholder="e.g. Gulshan, Banani, Dhanmondi" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Budget (BDT)</Label>
            <div className="flex flex-wrap gap-2">
              {BUDGETS.map((b) => (
                <button
                  key={b} type="button" onClick={() => setBudget(b === budget ? "" : b)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    budget === b ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background hover:bg-accent"
                  )}
                >{b}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Property type</Label>
              <Select value={propertyType} onValueChange={setPropertyType}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {PROPERTY_TYPES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Move-in urgency</Label>
              <Select value={urgency} onValueChange={setUrgency}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {URGENCIES.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Lead source</Label>
            <div className="flex flex-wrap gap-2">
              {sourcePills.map((s) => (
                <button
                  key={s} type="button" onClick={() => setSource(s)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    source === s ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background hover:bg-accent"
                  )}
                >{s}</button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lnotes">Notes</Label>
            <Textarea id="lnotes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save lead"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
