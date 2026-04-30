REVOKE EXECUTE ON FUNCTION public.prune_webhook_ip_attempts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prune_webhook_ip_attempts() FROM anon;
REVOKE EXECUTE ON FUNCTION public.prune_webhook_ip_attempts() FROM authenticated;