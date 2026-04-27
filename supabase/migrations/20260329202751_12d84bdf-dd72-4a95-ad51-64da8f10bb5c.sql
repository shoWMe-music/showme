ALTER TABLE public.events ADD COLUMN IF NOT EXISTS is_multi_performer boolean NOT NULL DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS parent_event_id text DEFAULT NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS child_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb;