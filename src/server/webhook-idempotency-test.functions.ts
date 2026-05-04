import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getRequestHost } from "@tanstack/react-start/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Step = {
  attempt: number;
  status: number;
  ok: boolean;
  body: Record<string, unknown> | null;
  duration_ms: number;
};

async function postOnce(opts: {
  url: string;
  body: unknown;
  secret: string;
  requestId: string;
}): Promise<Step & { attempt: 0 }> {
  const t0 = Date.now();
  const res = await fetch(opts.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-vapi-secret": opts.secret,
      "x-request-id": opts.requestId,
      "user-agent": "LeaseFlow-IdempotencyTest/1.0",
    },
    body: JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return {
    attempt: 0,
    status: res.status,
    ok: res.status === 200 && Boolean(json?.success),
    body: json,
    duration_ms: Date.now() - t0,
  };
}

export const runIdempotencyTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ agentRowId: z.string().uuid() }).parse(input),
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
    const a = agent as { agent_id: string; webhook_secret: string; is_active: boolean };
    if (!a.is_active) throw new Error("Agent is disabled");

    const host = getRequestHost();
    const proto = host?.includes("localhost") ? "http" : "https";
    const url = `${proto}://${host}/api/public/vapi-webhook`;

    // ---------------------------------------------------------------
    // PHASE 1 — Lead idempotency.
    // Three POSTs of the same lead payload with the same x-request-id.
    // Expect: exactly ONE lead row created; subsequent attempts return the
    // same lead_id with idempotent_replay: true.
    // ---------------------------------------------------------------
    const leadRequestId = randomUUID();
    const marker = `idem-test-${leadRequestId.slice(0, 8)}`;
    const leadPayload = {
      agent_id: a.agent_id,
      caller_phone: "+8801700000001",
      extracted_name: marker,
      extracted_location: "Idempotency Test",
      extracted_budget: "1",
      extracted_property_type: "apartment",
      extracted_urgency: "now",
      notes: "Synthetic idempotency test — safe to delete.",
    };

    const leadSteps: Step[] = [];
    for (let i = 1; i <= 3; i++) {
      const s = await postOnce({
        url,
        body: leadPayload,
        secret: a.webhook_secret,
        requestId: leadRequestId,
      });
      leadSteps.push({ ...s, attempt: i });
    }

    // Count actual lead rows created by this request_id (via marker).
    const { data: leadsRows } = await supabaseAdmin
      .from("leads")
      .select("id")
      .eq("user_id", userId)
      .eq("full_name", marker);
    const leadRowsCreated = leadsRows?.length ?? 0;
    const distinctLeadIds = Array.from(
      new Set(
        leadSteps
          .map((s) => (s.body?.lead_id as string | undefined) ?? null)
          .filter((v): v is string => Boolean(v)),
      ),
    );
    const replays = leadSteps.filter((s) => Boolean(s.body?.idempotent_replay)).length;

    const leadPass =
      leadSteps.every((s) => s.ok) &&
      leadRowsCreated === 1 &&
      distinctLeadIds.length === 1 &&
      replays === leadSteps.length - 1;

    // ---------------------------------------------------------------
    // PHASE 2 — Session + transcript dedup.
    // Three POSTs of the same Vapi transcript event (same vapi call.id and
    // same transcript text). Each request gets its OWN x-request-id (Vapi
    // does this on retries of distinct deliveries) — dedup must come from:
    //   - call_sessions UNIQUE(vapi_call_id) → one session
    //   - call_transcripts UNIQUE(session_id, role, md5(text)) → one snippet
    // ---------------------------------------------------------------
    const vapiCallId = `call_${randomUUID().replace(/-/g, "")}`;
    const transcriptText = `idempotency-probe ${leadRequestId.slice(0, 8)}`;
    const eventPayload = {
      message: {
        type: "transcript",
        transcriptType: "final",
        role: "user",
        transcript: transcriptText,
        call: {
          id: vapiCallId,
          assistantId: a.agent_id,
        },
      },
    };

    const eventSteps: Step[] = [];
    for (let i = 1; i <= 3; i++) {
      const s = await postOnce({
        url,
        body: eventPayload,
        secret: a.webhook_secret,
        requestId: randomUUID(),
      });
      eventSteps.push({ ...s, attempt: i });
    }

    const { data: sessionsRows } = await supabaseAdmin
      .from("call_sessions")
      .select("id")
      .eq("user_id", userId)
      .eq("vapi_call_id", vapiCallId);
    const sessionRowsCreated = sessionsRows?.length ?? 0;
    const sessionId = sessionsRows?.[0]?.id ?? null;

    let transcriptRowsCreated = 0;
    if (sessionId) {
      const { data: trRows } = await supabaseAdmin
        .from("call_transcripts")
        .select("id")
        .eq("session_id", sessionId)
        .eq("role", "user")
        .eq("text", transcriptText);
      transcriptRowsCreated = trRows?.length ?? 0;
    }

    const eventsPass =
      eventSteps.every((s) => s.ok) &&
      sessionRowsCreated === 1 &&
      transcriptRowsCreated === 1;

    // Cleanup — remove the synthetic rows so the test leaves no trace.
    if (sessionId) {
      await supabaseAdmin.from("call_transcripts").delete().eq("session_id", sessionId);
      await supabaseAdmin.from("call_sessions").delete().eq("id", sessionId);
    }
    if (distinctLeadIds.length > 0) {
      await supabaseAdmin.from("leads").delete().in("id", distinctLeadIds);
    }

    return {
      ok: leadPass && eventsPass,
      url,
      lead: {
        pass: leadPass,
        request_id: leadRequestId,
        attempts: leadSteps,
        rows_created: leadRowsCreated,
        distinct_lead_ids: distinctLeadIds.length,
        replays_detected: replays,
      },
      events: {
        pass: eventsPass,
        vapi_call_id: vapiCallId,
        attempts: eventSteps,
        sessions_created: sessionRowsCreated,
        transcripts_created: transcriptRowsCreated,
      },
    };
  });
