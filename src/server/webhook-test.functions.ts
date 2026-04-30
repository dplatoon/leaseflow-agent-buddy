import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getRequestHost, getRequestHeader } from "@tanstack/react-start/server";

export const sendWebhookTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        agentRowId: z.string().uuid(),
        useBadSecret: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: agent, error } = await supabase
      .from("agents")
      .select("agent_id, webhook_secret, is_active")
      .eq("id", data.agentRowId)
      .eq("user_id", userId)
      .single();
    if (error) throw new Error(error.message);
    if (!agent) throw new Error("Agent not found");

    const host = getRequestHost();
    const proto =
      getRequestHeader("x-forwarded-proto") ??
      (host?.includes("localhost") ? "http" : "https");
    const url = `${proto}://${host}/api/public/vapi-webhook`;

    const sample = {
      agent_id: (agent as { agent_id: string }).agent_id,
      caller_phone: "+8801700000000",
      extracted_name: "Test Lead (LeaseFlow check)",
      extracted_location: "Gulshan, Dhaka",
      extracted_budget: "50000",
      extracted_property_type: "apartment",
      extracted_urgency: "this_week",
      notes: "Synthetic webhook test from Settings panel.",
    };

    const secret = data.useBadSecret
      ? "whsec_invalid_test_secret"
      : (agent as { webhook_secret: string }).webhook_secret;

    const startedAt = Date.now();
    let status = 0;
    let bodyJson: Record<string, unknown> | null = null;
    let bodyText = "";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-vapi-secret": secret,
          "user-agent": "LeaseFlow-WebhookTest/1.0",
        },
        body: JSON.stringify(sample),
      });
      status = res.status;
      bodyText = await res.text();
      try {
        bodyJson = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : null;
      } catch {
        bodyJson = null;
      }
    } catch (e) {
      return {
        ok: false,
        url,
        status: 0,
        duration_ms: Date.now() - startedAt,
        authOk: false,
        insertOk: false,
        leadId: null as string | null,
        message: e instanceof Error ? e.message : String(e),
        body: "",
      };
    }

    const authOk = status !== 401 && status !== 403;
    const insertOk = status === 200 && Boolean(bodyJson?.success);
    const leadId = (bodyJson?.lead_id as string | undefined) ?? null;

    return {
      ok: insertOk,
      url,
      status,
      duration_ms: Date.now() - startedAt,
      authOk,
      insertOk,
      leadId,
      message:
        (bodyJson?.error as string | undefined) ??
        (insertOk ? "Test lead inserted" : bodyText.slice(0, 240)),
      body: bodyText.slice(0, 1000),
    };
  });