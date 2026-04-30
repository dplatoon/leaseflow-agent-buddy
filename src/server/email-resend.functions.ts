import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_WINDOW = 3;

export const resendVerificationEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;

    // Look up user (admin) to get email + confirmation status.
    const { data: userRes, error: userErr } =
      await supabaseAdmin.auth.admin.getUserById(userId);
    if (userErr || !userRes?.user) {
      throw new Error("User not found");
    }
    const user = userRes.user;
    if (user.email_confirmed_at) {
      return { ok: true, alreadyConfirmed: true, remaining: MAX_PER_WINDOW };
    }
    if (!user.email) {
      throw new Error("No email on account");
    }

    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count, error: countErr } = await supabaseAdmin
      .from("email_resend_attempts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since);
    if (countErr) throw new Error(countErr.message);

    const used = count ?? 0;
    if (used >= MAX_PER_WINDOW) {
      // Find oldest attempt in window to compute retry-after.
      const { data: oldest } = await supabaseAdmin
        .from("email_resend_attempts")
        .select("created_at")
        .eq("user_id", userId)
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      const retryAt = oldest
        ? new Date(new Date(oldest.created_at).getTime() + WINDOW_MS).toISOString()
        : new Date(Date.now() + WINDOW_MS).toISOString();
      const err = new Error(
        `Too many resend attempts. Try again after ${new Date(retryAt).toLocaleTimeString()}.`,
      );
      (err as Error & { code?: string }).code = "rate_limited";
      throw err;
    }

    // Record the attempt before sending so concurrent calls can't bypass the cap.
    const { error: insErr } = await supabaseAdmin
      .from("email_resend_attempts")
      .insert({ user_id: userId, email: user.email });
    if (insErr) throw new Error(insErr.message);

    // Generate a fresh signup confirmation link (also triggers Supabase to send email).
    const { error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "signup",
      email: user.email,
      options: {
        redirectTo: `${process.env.SUPABASE_URL ? "" : ""}${
          process.env.SITE_URL ?? ""
        }/dashboard`,
      },
    });
    if (linkErr) throw new Error(linkErr.message);

    return {
      ok: true,
      alreadyConfirmed: false,
      remaining: MAX_PER_WINDOW - used - 1,
    };
  });

export const getResendStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count } = await supabaseAdmin
      .from("email_resend_attempts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since);
    const used = count ?? 0;
    return {
      remaining: Math.max(0, MAX_PER_WINDOW - used),
      max: MAX_PER_WINDOW,
      windowMs: WINDOW_MS,
    };
  });
