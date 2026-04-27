
-- ===== shoWMe Platform Database Schema =====

-- Timestamp update function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ── User Settings ──
CREATE TABLE public.user_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  initials TEXT NOT NULL DEFAULT '',
  roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  currency TEXT NOT NULL DEFAULT 'EUR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to user_settings" ON public.user_settings FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Profiles ──
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL UNIQUE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to profiles" ON public.profiles FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Team Members ──
CREATE TABLE public.team_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Member',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to team_members" ON public.team_members FOR ALL USING (true) WITH CHECK (true);

-- ── Events ──
CREATE TABLE public.events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  venue TEXT NOT NULL,
  operator TEXT NOT NULL,
  operator_type TEXT NOT NULL,
  ticketing_provider TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 0,
  artist TEXT NOT NULL DEFAULT '',
  event_status TEXT NOT NULL DEFAULT 'suggested',
  settlement_status TEXT NOT NULL DEFAULT 'draft',
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to events" ON public.events FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Deals ──
CREATE TABLE public.deals (
  event_id TEXT PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to deals" ON public.deals FOR ALL USING (true) WITH CHECK (true);

-- ── Ticket Revenue ──
CREATE TABLE public.ticket_revenue (
  event_id TEXT PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ticket_revenue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to ticket_revenue" ON public.ticket_revenue FOR ALL USING (true) WITH CHECK (true);

-- ── Settlements ──
CREATE TABLE public.settlements (
  event_id TEXT PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to settlements" ON public.settlements FOR ALL USING (true) WITH CHECK (true);

-- ── Parties ──
CREATE TABLE public.parties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  contacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  iban TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  vat_id TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to parties" ON public.parties FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER update_parties_updated_at BEFORE UPDATE ON public.parties FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Calendar Items ──
CREATE TABLE public.calendar_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'task',
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  start_time TEXT,
  end_time TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.calendar_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to calendar_items" ON public.calendar_items FOR ALL USING (true) WITH CHECK (true);

-- ── Event Manager Data ──
CREATE TABLE public.event_manager_data (
  event_id TEXT PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.event_manager_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to event_manager_data" ON public.event_manager_data FOR ALL USING (true) WITH CHECK (true);

-- ── Share Tokens ──
CREATE TABLE public.share_tokens (
  token TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  parties JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.share_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to share_tokens" ON public.share_tokens FOR ALL USING (true) WITH CHECK (true);
