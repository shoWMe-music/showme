
CREATE TABLE public.budget_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'custom',
  revenue_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  cost_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  result_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.budget_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to budget_templates" ON public.budget_templates FOR ALL TO public USING (true) WITH CHECK (true);
