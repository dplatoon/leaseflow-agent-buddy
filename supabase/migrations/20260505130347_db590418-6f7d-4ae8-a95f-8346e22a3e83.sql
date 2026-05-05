-- Revoke client (authenticated/anon) SELECT on sensitive columns.
-- These are only needed server-side via service role.
REVOKE SELECT (webhook_secret) ON public.agents FROM authenticated, anon;
REVOKE SELECT (webhook_secret, stripe_customer_id) ON public.profiles FROM authenticated, anon;

-- Also block direct UPDATE of webhook_secret from clients (only server-side rotate flow should set it).
REVOKE UPDATE (webhook_secret) ON public.agents FROM authenticated, anon;
REVOKE UPDATE (webhook_secret, stripe_customer_id) ON public.profiles FROM authenticated, anon;

COMMENT ON COLUMN public.agents.webhook_secret IS
  'Server-only. Read via server functions (service role) and surfaced to the owner via dedicated RPC. Not selectable by clients.';
COMMENT ON COLUMN public.profiles.webhook_secret IS
  'Server-only. Validated by the public webhook endpoint. Not selectable by clients.';
COMMENT ON COLUMN public.profiles.stripe_customer_id IS
  'Server-only. Used by billing server functions. Not selectable by clients.';