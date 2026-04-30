import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";
import { timingSafeEqual, randomUUID } from "crypto";

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

type LogStage =
  | "received"
  | "unauthorized"
  | "misconfigured"
  | "unsupported_media_type"
  | "payload_too_large"
  | "invalid_body"
  | "invalid_json"
  | "invalid_payload"
  | "profile_lookup_failed"
  | "unknown_agent"
  | "insert_failed"
  | "success";

function log(
  level: "info" | "warn" | "error",
  requestId: string,
  stage: LogStage,
  fields: Record<string, unknown> = {},
) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope: "vapi-webhook",
    request_id: requestId,
    stage,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function jsonResponse(status: number, body: Record<string, unknown>, requestId: string) {
  return new Response(JSON.stringify({ request_id: requestId, ...body }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "x-request-id": requestId,
    },
  });
}

type WebhookStatus =
  | "authorized"
  | "unauthorized"
  | "invalid"
  | "inserted"
  | "failed";

function statusForStage(stage: LogStage): WebhookStatus {
  switch (stage) {
    case "success":
      return "inserted";
    case "unauthorized":
      return "unauthorized";
    case "invalid_body":
    case "invalid_json":
    case "invalid_payload":
    case "unsupported_media_type":
    case "payload_too_large":
      return "invalid";
    case "misconfigured":
    case "profile_lookup_failed":
    case "unknown_agent":
    case "insert_failed":
      return "failed";
    default:
      return "authorized";
  }
}

async function recordWebhookLog(entry: {
  request_id: string;
  status: WebhookStatus;
  stage: LogStage;
  http_status: number;
  agent_id?: string | null;
  user_id?: string | null;
  lead_id?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  duration_ms: number;
  error_message?: string | null;
  payload_summary?: Record<string, unknown> | null;
}) {
  try {
    const { error } = await supabaseAdmin.from("webhook_logs").insert({
      request_id: entry.request_id,
      source: "vapi",
      status: entry.status,
      stage: entry.stage,
      http_status: entry.http_status,
      agent_id: entry.agent_id ?? null,
      user_id: entry.user_id ?? null,
      lead_id: entry.lead_id ?? null,
      ip: entry.ip ?? null,
      user_agent: entry.user_agent ?? null,
      duration_ms: entry.duration_ms,
      error_message: entry.error_message ?? null,
      payload_summary: entry.payload_summary ?? null,
    } as never);
    if (error) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          scope: "vapi-webhook",
          request_id: entry.request_id,
          stage: "log_persist_failed",
          db_error: error.message,
          code: error.code,
        }),
      );
    }
  } catch (e) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        scope: "vapi-webhook",
        request_id: entry.request_id,
        stage: "log_persist_threw",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }
}

export const Route = createFileRoute("/api/public/vapi-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestId =
          request.headers.get("x-request-id") || randomUUID();
        const startedAt = Date.now();
        const ip =
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for") ||
          null;
        const userAgent = request.headers.get("user-agent") || null;
        const contentLengthHeader = request.headers.get("content-length");

        log("info", requestId, "received", {
          method: "POST",
          ip,
          user_agent: userAgent,
          content_length: contentLengthHeader,
        });

        const finish = (
          status: number,
          body: Record<string, unknown>,
          level: "info" | "warn" | "error",
          stage: LogStage,
          extra: Record<string, unknown> = {},
        ) => {
          log(level, requestId, stage, {
            status,
            duration_ms: Date.now() - startedAt,
            ...extra,
          });
          // Fire-and-forget DB log; never block the HTTP response.
          void recordWebhookLog({
            request_id: requestId,
            status: statusForStage(stage),
            stage,
            http_status: status,
            agent_id:
              (extra.agent_id as string | undefined) ?? null,
            user_id: (extra.user_id as string | undefined) ?? null,
            lead_id: (extra.lead_id as string | undefined) ?? null,
            ip,
            user_agent: userAgent,
            duration_ms: Date.now() - startedAt,
            error_message:
              level === "error" || level === "warn"
                ? (body.error as string | undefined) ?? null
                : null,
            payload_summary: {
              has_phone: extra.has_phone ?? null,
              has_name: extra.has_name ?? null,
              content_type: extra.content_type ?? null,
              content_length: extra.content_length ?? null,
              body_bytes: extra.body_bytes ?? null,
              reason: extra.reason ?? null,
              field_errors: extra.field_errors ?? null,
              form_errors: extra.form_errors ?? null,
              db_code: extra.code ?? null,
            },
          });
          return jsonResponse(status, body, requestId);
        };

        const expected = process.env.VAPI_WEBHOOK_SECRET;
        if (!expected) {
          return finish(
            500,
            { error: "Webhook not configured" },
            "error",
            "misconfigured",
            { reason: "VAPI_WEBHOOK_SECRET not set" },
          );
        }
        const provided = request.headers.get("x-vapi-secret");
        if (!provided || !safeEqual(provided, expected)) {
          return finish(401, { error: "Unauthorized" }, "warn", "unauthorized", {
            secret_present: Boolean(provided),
          });
        }

        // Enforce JSON content-type
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("application/json")) {
          return finish(
            415,
            { error: "Unsupported Media Type" },
            "warn",
            "unsupported_media_type",
            { content_type: contentType },
          );
        }

        // Reject oversized payloads (use Content-Length when present, also cap raw read)
        if (contentLengthHeader && Number(contentLengthHeader) > MAX_BODY_BYTES) {
          return finish(
            413,
            { error: "Payload too large" },
            "warn",
            "payload_too_large",
            { content_length: contentLengthHeader, limit: MAX_BODY_BYTES },
          );
        }

        let raw: string;
        try {
          raw = await request.text();
        } catch {
          return finish(400, { error: "Invalid body" }, "warn", "invalid_body");
        }
        if (raw.length > MAX_BODY_BYTES) {
          return finish(
            413,
            { error: "Payload too large" },
            "warn",
            "payload_too_large",
            { body_bytes: raw.length, limit: MAX_BODY_BYTES },
          );
        }

        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          return finish(
            400,
            { error: "Invalid JSON" },
            "warn",
            "invalid_json",
            { body_bytes: raw.length },
          );
        }
        if (!json || typeof json !== "object" || Array.isArray(json)) {
          return finish(
            400,
            { error: "Payload must be a JSON object" },
            "warn",
            "invalid_payload",
            { reason: "not_object" },
          );
        }

        const parsed = PayloadSchema.safeParse(json);
        if (!parsed.success) {
          const flat = parsed.error.flatten();
          return finish(
            400,
            { error: "Invalid payload", details: flat },
            "warn",
            "invalid_payload",
            { field_errors: flat.fieldErrors, form_errors: flat.formErrors },
          );
        }
        const p = parsed.data;

        const { data: profile, error: pErr } = await supabaseAdmin
          .from("profiles").select("id").eq("agent_id", p.agent_id).maybeSingle();
        if (pErr) {
          return finish(
            500,
            { error: "Lookup failed" },
            "error",
            "profile_lookup_failed",
            { agent_id: p.agent_id, db_error: pErr.message, code: pErr.code },
          );
        }
        if (!profile) {
          return finish(
            404,
            { error: "Unknown agent_id" },
            "warn",
            "unknown_agent",
            { agent_id: p.agent_id },
          );
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
          return finish(
            500,
            { error: "Insert failed" },
            "error",
            "insert_failed",
            {
              agent_id: p.agent_id,
              user_id: profile.id,
              db_error: iErr.message,
              code: iErr.code,
            },
          );
        }

        return finish(
          200,
          { success: true, lead_id: inserted?.id },
          "info",
          "success",
          {
            agent_id: p.agent_id,
            user_id: profile.id,
            lead_id: inserted?.id,
            has_phone: Boolean(p.caller_phone),
            has_name: Boolean(p.extracted_name),
          },
        );
      },
    },
  },
});
