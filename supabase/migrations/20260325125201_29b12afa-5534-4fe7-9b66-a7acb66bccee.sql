CREATE TABLE public.collaborator_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  event_id text NOT NULL,
  email text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'Artist',
  permission text NOT NULL DEFAULT 'editor',
  password text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.collaborator_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to collaborator_invites"
  ON public.collaborator_invites FOR ALL TO public
  USING (true) WITH CHECK (true);