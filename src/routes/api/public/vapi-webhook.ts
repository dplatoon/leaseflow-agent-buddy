import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

const PayloadSchema = z.object({
  caller_phone: z.string().min(1).max(50).optional(),
  extracted_name: z.string().min(1).max(200).optional(),
  extracted_location: z.string().max(200).optional(),
  extracted_budget: z.string().max(50).optional(),
  extracted_property_type: z.string().max(50).optional(),
  extracted_urgency: z.string().max(50).optional(),
  agent_id: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
});

export const Route = createFileRoute("/api/public/vapi-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.VAPI_WEBHOOK_SECRET;
        const provided = request.headers.get("x-vapi-secret");
        if (!expected) {
          return new Response(JSON.stringify({ error: "Webhook not configured" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
        if (!provided || provided !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }

        let json: unknown;
        try { json = await request.json(); }
        catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } }); }

        const parsed = PayloadSchema.safeParse(json);
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "Invalid payload", details: parsed.error.flatten() }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        const p = parsed.data;

        const { data: profile, error: pErr } = await supabaseAdmin
          .from("profiles").select("id").eq("agent_id", p.agent_id).maybeSingle();
        if (pErr) {
          console.error("[vapi-webhook] profile lookup failed", pErr);
          return new Response(JSON.stringify({ error: "Lookup failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
        if (!profile) {
          return new Response(JSON.stringify({ error: "Unknown agent_id" }), { status: 404, headers: { "Content-Type": "application/json" } });
        }

        const { data: inserted, error: iErr } = await supabaseAdmin.from("leads").insert({
          user_id: profile.id,
          full_name: p.extracted_name?.trim() || "Unknown caller",
          phone: p.caller_phone ?? null,
          location: p.extracted_location ?? null,
          budget: p.extracted_budget ?? null,
          property_type: p.extracted_property_type ?? null,
          urgency: p.extracted_urgency ?? null,
          source: "Vapi Call",
          status: "New",
          notes: p.notes ?? null,
        }).select("id").single();

        if (iErr) {
          console.error("[vapi-webhook] insert failed", iErr);
          return new Response(JSON.stringify({ error: "Insert failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }

        return new Response(JSON.stringify({ success: true, lead_id: inserted?.id }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
  },
});
