import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const syncNewLeadsToSheets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("sheets_webhook_url")
      .eq("id", userId)
      .single();
    if (profErr) throw new Error(profErr.message);

    const url = (profile as { sheets_webhook_url: string | null } | null)?.sheets_webhook_url?.trim();
    if (!url) {
      throw new Error("No Google Sheets webhook URL configured. Add one in Settings.");
    }
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") throw new Error("URL must be https");
    } catch {
      throw new Error("Invalid Google Sheets webhook URL");
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: leads, error: leadsErr } = await supabase
      .from("leads")
      .select("*")
      .eq("status", "New")
      .eq("synced_to_sheets", false)
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    if (leadsErr) throw new Error(leadsErr.message);

    const total = leads?.length ?? 0;
    let synced = 0;
    const failures: { id: string; error: string }[] = [];

    for (const lead of leads ?? []) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead }),
          redirect: "follow",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { error: upErr } = await supabase
          .from("leads")
          .update({ synced_to_sheets: true })
          .eq("id", (lead as { id: string }).id);
        if (upErr) throw new Error(upErr.message);
        synced += 1;
      } catch (e) {
        failures.push({
          id: (lead as { id: string }).id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { total, synced, failures };
  });