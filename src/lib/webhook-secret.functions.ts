import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { randomBytes } from "crypto";

function generateSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}

export const getWebhookSecret = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("webhook_secret, agent_id")
      .eq("id", userId)
      .single();
    if (error) throw new Error(error.message);
    return {
      secret: (data as { webhook_secret: string }).webhook_secret,
      agent_id: data.agent_id,
    };
  });

export const regenerateWebhookSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const next = generateSecret();
    const { error } = await supabase
      .from("profiles")
      .update({ webhook_secret: next })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { secret: next };
  });
