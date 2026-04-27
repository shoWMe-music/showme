
ALTER TABLE public.share_tokens DROP CONSTRAINT IF EXISTS share_tokens_event_id_fkey;
ALTER TABLE public.event_manager_data DROP CONSTRAINT IF EXISTS event_manager_data_event_id_fkey;
