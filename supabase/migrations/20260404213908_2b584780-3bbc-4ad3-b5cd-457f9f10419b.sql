
CREATE TABLE public.booking_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  artist_name TEXT NOT NULL DEFAULT '',
  wanted_date TEXT NOT NULL DEFAULT '',
  artist_fee NUMERIC,
  note TEXT NOT NULL DEFAULT '',
  target_profile_slug TEXT NOT NULL DEFAULT '',
  target_role TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'profile'
);

ALTER TABLE public.booking_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public insert on booking_requests"
ON public.booking_requests
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow public select on booking_requests"
ON public.booking_requests
FOR SELECT
USING (true);

CREATE POLICY "Allow public update on booking_requests"
ON public.booking_requests
FOR UPDATE
USING (true);

CREATE TRIGGER update_booking_requests_updated_at
BEFORE UPDATE ON public.booking_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
