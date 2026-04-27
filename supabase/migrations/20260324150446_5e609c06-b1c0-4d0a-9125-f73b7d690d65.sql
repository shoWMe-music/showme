CREATE TABLE bills_invoices (
  id text PRIMARY KEY,
  type text NOT NULL DEFAULT 'invoice',
  number text NOT NULL DEFAULT '',
  date text NOT NULL DEFAULT '',
  due_date text NOT NULL DEFAULT '',
  recipient text NOT NULL DEFAULT '',
  event_id text DEFAULT NULL,
  line_items jsonb NOT NULL DEFAULT '[]',
  subtotal numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bills_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to bills_invoices" ON bills_invoices FOR ALL TO public USING (true) WITH CHECK (true);