-- The PRO fee on every budget in the app was the same 6%, everywhere.
--
-- `packages/shared/src/performing-rights.ts` charged a flat 600 basis points of
-- ticket revenue and reported `tariffSource: 'planning_default'` — a number
-- carried over from the design prototype, honest about being nobody's tariff
-- because there was no tariff data in the repository to be honest with. A
-- Stockholm show and a Berlin show got the identical figure, and neither figure
-- was STIM's or GEMA's.
--
-- It is a per-territory number. decisions.md #17 says so explicitly: the
-- `country` stamp is what drives "VAT, PRO codes (STIM/GEMA/PRS), currency". This
-- migration gives that stamp something to resolve against.

-- One row per TERRITORY, keyed on the country, not on the society.
--
-- The chain is country → society → tariff, and either of the last two could have
-- carried the rate. The country wins for three reasons:
--
--   1. #17 puts the country UPSTREAM. The PRO is one of the things a country
--      determines, so keying the rate on the PRO keys it on a derived value.
--   2. The `pro_code` enum cannot hold the territories. It has four values
--      (stim | gema | prs | none) and it is the FILING vocabulary of
--      `performance_reports`, while the app's own country → society register
--      (`apps/web/src/lib/proSocieties.ts`) already names twenty societies. A
--      PRO-keyed table would need one ALTER TYPE per territory before an admin
--      could record a number — a schema migration to enter a percentage.
--   3. A society is not one tariff. SACEM administers France, Monaco and
--      Luxembourg under different national rules. The rate is a fact about a
--      territory that a society collects, not a property of the society.
--
-- So the society rides along as two columns doing two different jobs: `pro_code`
-- is the filing destination of record (mostly 'none', because we cannot file
-- anywhere yet), and `pro_name` is the name a human reads on the Budget Planner
-- card — which is what lets Sweden be STIM's 7.5% and France be SACEM's without
-- the enum having to grow.
CREATE TABLE IF NOT EXISTS "performing_rights_rates" (
  "country" text PRIMARY KEY,
  "pro_code" "pro_code" NOT NULL DEFAULT 'none',
  "pro_name" text NOT NULL,
  "rate_basis_points" integer NOT NULL,
  -- The published tariff the rate was read off, and which tariff it is. Optional,
  -- and the most valuable pair of columns in the table: a percentage typed by an
  -- admin with nothing behind it is exactly as unfounded as the flat 6% this
  -- table replaces, and the card should be able to link out to the proof.
  "source_url" text,
  "source_note" text,
  "updated_by" text REFERENCES "users" ("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- The primary key is a country code, so it had better BE a country code.
--
-- The resolver (`findPerformingRightsRate`) matches on the normalized alpha-2
-- form, which means a row written as 'sweden' or 'SE ' silently governs nothing —
-- it looks configured in the admin list and never fires for a single event. That
-- is the worst failure this feature has: an admin who believes Sweden is priced.
-- Refuse the row instead. `packages/shared/src/countries.ts` makes the same
-- argument for `representations.region` (audit A-18) and the same discipline
-- applies here.
--
-- Alpha-2 SHAPE only, not membership of the ISO register: which strings are
-- countries is a question the API answers with `isCountryCode`, and duplicating
-- 249 codes into a CHECK constraint would mean a migration every time the
-- register changes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'performing_rights_rates_country_alpha2_check'
  ) THEN
    ALTER TABLE "performing_rights_rates"
      ADD CONSTRAINT "performing_rights_rates_country_alpha2_check"
      CHECK ("country" ~ '^[A-Z]{2}$');
  END IF;
END
$$;

-- A rate is a share of ticket revenue, so it lives between nothing and all of it.
--
-- Basis points, like every other rate in this schema (money.md: rates are integer
-- basis points, never floats) — 600 = 6.00%. The ceiling is not pedantry: the one
-- typo this column invites is a percentage entered as a percentage, and `7.5`
-- typed where `750` was meant charges a show 0.075% while `10000` typed where
-- `1000` was meant charges it everything. Only the second is catchable, so catch
-- it; the first is the admin UI's problem and the `source_url` column's.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'performing_rights_rates_rate_range_check'
  ) THEN
    ALTER TABLE "performing_rights_rates"
      ADD CONSTRAINT "performing_rights_rates_rate_range_check"
      CHECK ("rate_basis_points" >= 0 AND "rate_basis_points" <= 10000);
  END IF;
END
$$;

-- NO SEED ROWS. Deliberately.
--
-- It would be one INSERT to put 7.5% against SE and 8% against DE and have the
-- feature "work" on first boot. Those numbers would be invented, and the moment
-- they are in the table the planner stops saying `planning_default` and starts
-- presenting them as the territory's tariff — which is precisely the dishonesty
-- the flat-6% comment block has been guarding against since the module was
-- written. An empty table means every event keeps the qualified estimate it has
-- today until a human reads a published tariff and types it in. That is the
-- feature working, not the feature waiting.
