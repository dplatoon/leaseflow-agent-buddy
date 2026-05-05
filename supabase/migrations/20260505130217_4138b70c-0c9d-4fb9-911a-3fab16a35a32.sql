-- Make webhook_ip_attempts explicitly server-only by adding an explicit deny policy
-- (RLS is already enabled with no policies, but we add an explicit FALSE policy for clarity)
CREATE POLICY "No client access to webhook_ip_attempts"
  ON public.webhook_ip_attempts
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.webhook_ip_attempts IS
  'Server-only table for webhook rate limiting. Written exclusively by the service role from edge/server functions. No client (authenticated or anon) access permitted.';