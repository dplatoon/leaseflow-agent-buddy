import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";
import { timingSafeEqual } from "crypto";

const MAX_BODY_BYTES = 16 * 1024; // 16KB hard cap on payload size

// Strict schema: rejects unknown fields, enforces formats, trims strings.
const trimmed = (max: number) =>
  z.string().trim().min(1).max(max);

const PayloadSchema = z
  .object({
    agent_id: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^agent_[a-zA-Z0-9_-]+$/, "agent_id must match agent_<id>"),
    caller_phone: z
      .string()
      .trim()
      .min(3)
      .max(50)
      .regex(/^[+0-9 ()\-.]+$/, "caller_phone has invalid characters")
      .optional(),
    extracted_name: trimmed(200).optional(),
    extracted_location: trimmed(200).optional(),
    extracted_budget: trimmed(50).optional(),
    extracted_property_type: trimmed(50).optional(),
    extracted_urgency: trimmed(50).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/vapi-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.VAPI_WEBHOOK_SECRET;
        if (!expected) {
          console.error("[vapi-webhook] VAPI_WEBHOOK_SECRET is not set");
          return jsonResponse(500, { error: "Webhook not configured" });
        }
        const provided = request.headers.get("x-vapi-secret");
        if (!provided || !safeEqual(provided, expected)) {
          return jsonResponse(401, { error: "Unauthorized" });
        }

        // Enforce JSON content-type
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("application/json")) {
          return jsonResponse(415, { error: "Unsupported Media Type" });
        }

        // Reject oversized payloads (use Content-Length when present, also cap raw read)
        const lenHeader = request.headers.get("content-length");
        if (lenHeader && Number(lenHeader) > MAX_BODY_BYTES) {
          return jsonResponse(413, { error: "Payload too large" });
        }

        let raw: string;
        try {
          raw = await request.text();
        } catch {
          return jsonResponse(400, { error: "Invalid body" });
        }
        if (raw.length > MAX_BODY_BYTES) {
          return jsonResponse(413, { error: "Payload too large" });
        }

        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          return jsonResponse(400, { error: "Invalid JSON" });
        }
        if (!json || typeof json !== "object" || Array.isArray(json)) {
          return jsonResponse(400, { error: "Payload must be a JSON object" });
        }

        const parsed = PayloadSchema.safeParse(json);
        if (!parsed.success) {
          return jsonResponse(400, {
            error: "Invalid payload",
            details: parsed.error.flatten(),
          });
        }
        const p = parsed.data;

        const { data: profile, error: pErr } = await supabaseAdmin
          .from("profiles").select("id").eq("agent_id", p.agent_id).maybeSingle();
        if (pErr) {
          console.error("[vapi-webhook] profile lookup failed", pErr);
          return jsonResponse(500, { error: "Lookup failed" });
        }
        if (!profile) {
          return jsonResponse(404, { error: "Unknown agent_id" });
        }

        const { data: inserted, error: iErr } = await supabaseAdmin.from("leads").insert({
          user_id: profile.id,
          full_name: p.extracted_name || "Unknown caller",
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
          return jsonResponse(500, { error: "Insert failed" });
        }

        return jsonResponse(200, { success: true, lead_id: inserted?.id });
      },
    },
  },
});
