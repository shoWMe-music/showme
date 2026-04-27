
-- Add new columns to share_tokens for secure sharing
ALTER TABLE public.share_tokens 
  ADD COLUMN IF NOT EXISTS recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS snapshot_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sections jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Drop the old permissive policy
DROP POLICY IF EXISTS "Allow all access to share_tokens" ON public.share_tokens;

-- Authenticated users can read tokens where their email is in recipients
CREATE POLICY "Recipients can view their share tokens"
ON public.share_tokens
FOR SELECT
TO authenticated
USING (
  recipients::jsonb @> to_jsonb(array[(SELECT email FROM auth.users WHERE id = auth.uid())])
);

-- Authenticated users can insert share tokens
CREATE POLICY "Authenticated users can create share tokens"
ON public.share_tokens
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Service role can always read (for edge functions)
CREATE POLICY "Service role full access"
ON public.share_tokens
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
