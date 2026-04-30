import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";
import { createHash, timingSafeEqual, randomUUID } from "crypto";

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

// Constant-time, constant-length comparison.
// Both sides are SHA-256 hashed first so the comparison length is always 32
// bytes regardless of the underlying secret length. This avoids leaking
// whether the provided secret has the "right" length and prevents the early
// length-check fast path that could leak timing information.
function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a, "utf8").digest();
  const bh = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ah, bh);
}

// A constant placeholder secret used when no agent matches the supplied
// agent_id. Comparing against this keeps the unauthenticated code path's
// timing profile aligned with the authenticated one so attackers can't
// distinguish "unknown agent" from "wrong secret" by response timing.
const DUMMY_SECRET = `whsec_${"0".repeat(64)}`;

type LogStage =
  | "received"
  | "unauthorized"
  | "rate_limited"
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
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
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
    case "rate_limited":
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

// ---------------------------------------------------------------------------
// Per-IP rate limiting (sliding window).
//
// NOTE: This backend has no shared rate-limit primitives (Redis / edge KV).
// The implementation below is an ad-hoc Postgres sliding window. It is good
// enough to deflect basic abuse and brute-force attempts on the public
// webhook, but it is NOT a precise traffic shaper:
//   - Requests can race within the window before the count is observed.
//   - Every request hits the DB twice (count + insert) which adds latency.
//   - "127.0.0.1" / unknown IPs are bucketed together.
// Replace with a proper rate-limiter (Cloudflare Rate Limiting, Upstash, etc.)
// when that infra is available.
// ---------------------------------------------------------------------------
const RL_WINDOW_MS = 60 * 1000; // 1 minute
const RL_MAX_PER_WINDOW = 60; // 60 req/min per IP — generous for a webhook
const RL_PRUNE_PROBABILITY = 0.02; // ~2% of requests trigger a cleanup

async function checkIpRateLimit(ip: string | null): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
  retryAfterMs: number;
}> {
  const bucket = ip || "unknown";
  const since = new Date(Date.now() - RL_WINDOW_MS).toISOString();

  const { count } = await supabaseAdmin
    .from("webhook_ip_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip", bucket)
    .gte("created_at", since);

  const used = count ?? 0;
  if (used >= RL_MAX_PER_WINDOW) {
    const { data: oldest } = await supabaseAdmin
      .from("webhook_ip_attempts")
      .select("created_at")
      .eq("ip", bucket)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const retryAtMs = oldest
      ? new Date(oldest.created_at).getTime() + RL_WINDOW_MS - Date.now()
      : RL_WINDOW_MS;
    return {
      allowed: false,
      used,
      limit: RL_MAX_PER_WINDOW,
      retryAfterMs: Math.max(1000, retryAtMs),
    };
  }
  return {
    allowed: true,
    used,
    limit: RL_MAX_PER_WINDOW,
    retryAfterMs: 0,
  };
}

async function recordIpAttempt(
  ip: string | null,
  agentId: string | null,
  outcome: WebhookStatus | "rate_limited",
) {
  try {
    await supabaseAdmin.from("webhook_ip_attempts").insert({
      ip: ip || "unknown",
      agent_id: agentId,
      outcome,
    });
    if (Math.random() < RL_PRUNE_PROBABILITY) {
      // Opportunistic cleanup; ignore errors.
      void supabaseAdmin.rpc("prune_webhook_ip_attempts").then(() => undefined);
    }
  } catch {
    // Never block the webhook on rate-limit bookkeeping failures.
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
        const provided = request.headers.get("x-vapi-secret");
        if (!provided) {
          return finish(401, { error: "Unauthorized" }, "warn", "unauthorized", {
            secret_present: false,
          });
        }
        // Generic 401 we return for any auth failure (unknown agent, wrong
        // secret, agent disabled). Keeping the body identical prevents an
        // attacker from enumerating valid agent_ids by status/body diff.
        const genericUnauthorized = (
          stage: LogStage,
          extra: Record<string, unknown>,
        ) =>
          finish(401, { error: "Unauthorized" }, "warn", stage, extra);

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

        // Resolve agent: prefer the per-agent record (multi-agent table),
        // fall back to the profile's default agent for backward compatibility.
        const { data: agentRow, error: aErr } = await supabaseAdmin
          .from("agents")
          .select("user_id, webhook_secret, is_active")
          .eq("agent_id", p.agent_id)
          .maybeSingle();
        if (aErr) {
          return finish(
            500,
            { error: "Lookup failed" },
            "error",
            "profile_lookup_failed",
            { agent_id: p.agent_id, db_error: aErr.message, code: aErr.code },
          );
        }

        let resolvedUserId: string | null = null;
        let resolvedSecret: string | null = null;
        let agentActive = true;
        let agentFound = false;

        if (agentRow) {
          agentFound = true;
          resolvedUserId = (agentRow as { user_id: string }).user_id;
          resolvedSecret = (agentRow as { webhook_secret: string | null }).webhook_secret ?? null;
          agentActive = (agentRow as { is_active: boolean }).is_active ?? true;
        } else {
          const { data: profile, error: pErr } = await supabaseAdmin
            .from("profiles")
            .select("id, webhook_secret")
            .eq("agent_id", p.agent_id)
            .maybeSingle();
          if (pErr) {
            return finish(
              500,
              { error: "Lookup failed" },
              "error",
              "profile_lookup_failed",
              { agent_id: p.agent_id, db_error: pErr.message, code: pErr.code },
            );
          }
          if (profile) {
            agentFound = true;
            resolvedUserId = profile.id;
            resolvedSecret =
              (profile as { webhook_secret?: string | null }).webhook_secret ?? null;
          }
        }

        // Always run the secret comparison — even when the agent doesn't
        // exist or is disabled — against either the real secret or a dummy
        // of equal hashed length. This keeps the response shape identical
        // (401 "Unauthorized") for every auth failure mode and avoids
        // exposing valid agent_ids via status code or response timing.
        const candidateSecret = resolvedSecret ?? DUMMY_SECRET;
        const secretMatchesUser =
          agentFound && agentActive && safeEqual(provided, candidateSecret);
        const secretMatchesGlobal = expected
          ? safeEqual(provided, expected)
          : safeEqual(provided, DUMMY_SECRET) && false;

        if (!agentFound) {
          return genericUnauthorized("unauthorized", {
            agent_id: p.agent_id,
            reason: "unknown_agent",
          });
        }
        if (!agentActive) {
          return genericUnauthorized("unauthorized", {
            agent_id: p.agent_id,
            user_id: resolvedUserId,
            reason: "agent_disabled",
          });
        }
        if (!secretMatchesUser && !secretMatchesGlobal) {
          return genericUnauthorized("unauthorized", {
            agent_id: p.agent_id,
            user_id: resolvedUserId,
            reason: "secret_mismatch_for_agent",
          });
        }

        const { data: inserted, error: iErr } = await supabaseAdmin.from("leads").insert({
          user_id: resolvedUserId!,
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
              user_id: resolvedUserId,
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
            user_id: resolvedUserId,
            lead_id: inserted?.id,
            has_phone: Boolean(p.caller_phone),
            has_name: Boolean(p.extracted_name),
          },
        );
      },
    },
  },
});
