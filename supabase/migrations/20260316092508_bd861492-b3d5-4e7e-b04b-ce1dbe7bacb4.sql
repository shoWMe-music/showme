
-- Messages table
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  sender_name text NOT NULL,
  content text DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to messages" ON public.messages
  FOR ALL TO public USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- Storage bucket for message attachments
INSERT INTO storage.buckets (id, name, public) VALUES ('message-attachments', 'message-attachments', true);

CREATE POLICY "Allow public read on message-attachments" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'message-attachments');

CREATE POLICY "Allow public insert on message-attachments" ON storage.objects
  FOR INSERT TO public WITH CHECK (bucket_id = 'message-attachments');
