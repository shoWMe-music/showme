-- `performance_reports` has never held a row, and could not have held a useful one.
--
-- The table is described in `schema/content.ts` as "the operator's PRO filing,
-- derived from a setlist" and decisions.md ("Setlists", RESOLVED) makes the
-- operator's filing one of the two halves of the setlist module. But the table
-- carried five columns — `id`, `event_id`, `pro_code`, `event_type`, `confidence`,
-- `estimate` — and not one of them says the only thing a filing record exists to
-- say: **that somebody filed, when, and who**. So the Reports screen printed a
-- hardcoded "Not filed" chip on every card forever, an operator who had genuinely
-- reported a show to STIM had nowhere to write that down, and the same report
-- could be exported and sent twice with no trace of the first time.
--
-- WHAT A ROW MEANS AFTER THIS MIGRATION, and the reason it is worth storing:
-- shoWMe cannot submit to a collecting society — there is no integration with
-- STIM, GEMA or anyone else, and `proFilingExport.ts` says so in the file it
-- writes ("Nothing has been submitted"). The real workflow is that the operator
-- downloads the works report and sends it to the society themselves. A row here
-- is the operator RECORDING that real-world act: the filing they made, on the
-- date they made it, with the reference the society gave back. It is a log of
-- something that happened outside the platform, not a claim that the platform
-- did it. That is a fact we can hold honestly today; a submission is not.

-- ── The two columns nothing ever defined ────────────────────────────────────
--
-- `event_type` and `confidence` were carried over from the design prototype's
-- royalty card and were never written, never read, and never given a vocabulary
-- anywhere in the repo — no enum, no CHECK, no doc comment saying what a value
-- would mean. `confidence` in particular invites exactly the guess this feature
-- must not make: a filing is either backed by a published tariff or it is not,
-- and `rate_basis_points IS NULL` below says which without asking anyone to
-- score their own certainty. Dropping them is cheaper than inventing meanings
-- for them later, and the table has no rows to lose.
ALTER TABLE "performance_reports" DROP COLUMN IF EXISTS "event_type";
ALTER TABLE "performance_reports" DROP COLUMN IF EXISTS "confidence";

-- ── Who filed, and when ─────────────────────────────────────────────────────
--
-- Both NOT NULL: a row exists BECAUSE somebody filed, so a filing with no filer
-- is not a partial record, it is a corrupt one. The user and the profile are two
-- different facts and both are wanted — the person is who to ask about it, the
-- profile is the operator the filing was made in the name of (a promoter who
-- works for two venues files for one of them, and the row has to say which).
ALTER TABLE "performance_reports" ADD COLUMN IF NOT EXISTS "filed_at" timestamptz NOT NULL DEFAULT now();
ALTER TABLE "performance_reports" ADD COLUMN IF NOT EXISTS "filed_by_user_id" text NOT NULL REFERENCES "users" ("id");
ALTER TABLE "performance_reports" ADD COLUMN IF NOT EXISTS "filed_by_profile_id" uuid NOT NULL REFERENCES "profiles" ("id");

-- The society's own receipt, when it gave one. Optional and free text, because
-- every society formats theirs differently and a shape we invented would refuse
-- the real one. NULL means "filed, no reference recorded" — which is the normal
-- case for a society that acknowledges by email.
ALTER TABLE "performance_reports" ADD COLUMN IF NOT EXISTS "reference" text;

-- ── Where it was filed ──────────────────────────────────────────────────────
--
-- STAMPED AT FILING, not resolved on read. The territory is derived from the
-- venue profile's country (decisions.md #17 — the PRO follows the country the
-- performance happened in, never the operator's own), and a venue can be edited,
-- re-addressed or replaced years later. A filing that re-derived its society on
-- every read would silently rewrite history the day somebody fixed a typo in an
-- address. Same discipline as the locked FX rate on a finalized settlement
-- (money.md): the record says what was true when the act was performed.
--
-- `country` is NOT NULL because a filing whose society is unknown is not a
-- filing — the API refuses to write one and tells the operator to put a country
-- on the venue instead, which is a thing they can go and do.
ALTER TABLE "performance_reports" ADD COLUMN IF NOT EXISTS "country" text NOT NULL;
ALTER TABLE "performance_reports" ADD COLUMN IF NOT EXISTS "pro_name" text NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'performance_reports_country_alpha2_check'
  ) THEN
    -- The same alpha-2 SHAPE check `performing_rights_rates` carries (0018), for
    -- the same reason: this column is compared against that table's primary key,
    -- and a row stored as 'sweden' would match nothing while looking filed.
    ALTER TABLE "performance_reports"
      ADD CONSTRAINT "performance_reports_country_alpha2_check"
      CHECK ("country" ~ '^[A-Z]{2}$');
  END IF;
END
$$;

-- ── What was filed ──────────────────────────────────────────────────────────
--
-- The works as they stood at filing, snapshotted. `setlists.items` belongs to the
-- performer and stays editable forever (`setlist.author` is theirs alone and no
-- operator may touch it), so the setlist is not evidence of what was reported —
-- an act that adds an encore next week would retroactively change what the
-- operator told STIM last month. The filing keeps its own copy, exactly as
-- `settlement_snapshots` does for the settlement it froze.
--
-- The count and the runtime are DERIVED from this column on read, not stored
-- beside it: two columns that can disagree with the array they summarise are two
-- columns that eventually will.
ALTER TABLE "performance_reports" ADD COLUMN IF NOT EXISTS "works" jsonb NOT NULL;

-- ── The royalty estimate, and its provenance ────────────────────────────────
--
-- `estimate` already existed (bigint, minor units, money.md) and had no basis, no
-- currency and no rate beside it — three things without which the number cannot
-- be checked, reproduced, or even read (12000 of what?).
--
-- ALL FOUR ARE NULLABLE TOGETHER, and that is the important case. The estimate is
-- `rate_basis_points` of ticket revenue where `rate_basis_points` comes from
-- `performing_rights_rates` for this country — a rate a platform admin read off a
-- published tariff. 0018 deliberately seeds no rows, so most territories have no
-- tariff, and for those the honest answer is NO NUMBER AT ALL. The Budget
-- Planner's flat-6% `planning_default` is explicitly NOT reused here: on a
-- planning card a qualified guess is useful, but on a filing it would be a
-- royalty figure attached to a named society on a real report, and nobody
-- invented it. NULL says "no published tariff is configured for SE", which is
-- true, fixable, and cannot be mistaken for a quote.
ALTER TABLE "performance_reports" ADD COLUMN IF NOT EXISTS "rate_basis_points" integer;
ALTER TABLE "performance_reports" ADD COLUMN IF NOT EXISTS "ticket_revenue" bigint;
ALTER TABLE "performance_reports" ADD COLUMN IF NOT EXISTS "estimate_currency" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'performance_reports_estimate_is_derivable'
  ) THEN
    -- An estimate may not exist without the rate, the basis and the currency that
    -- produced it. The whole point of the column is a number somebody can check.
    ALTER TABLE "performance_reports"
      ADD CONSTRAINT "performance_reports_estimate_is_derivable"
      CHECK (
        "estimate" IS NULL
        OR ("rate_basis_points" IS NOT NULL AND "ticket_revenue" IS NOT NULL AND "estimate_currency" IS NOT NULL)
      );
  END IF;
END
$$;

-- ── One filing per show ─────────────────────────────────────────────────────
--
-- A society is told about a performance once; a second report of the same night
-- is an AMENDMENT to the first, not a second performance. So the event is the
-- key, and re-filing updates this row (bumping `filed_at` and re-snapshotting the
-- works) rather than stacking a pile of near-identical rows a human would then
-- have to work out the newest of.
--
-- This is also what makes "the button must not offer to file the same thing twice
-- with no trace" true: once the row exists the screen reads it, shows when and by
-- whom, and the second click is labelled as a re-file. Every filing and re-filing
-- writes an `audit_log` entry, which is where the history of the amendments lives
-- — the audit trail is append-only and already exists, so this table does not
-- need to become one.
CREATE UNIQUE INDEX IF NOT EXISTS "performance_reports_one_per_event" ON "performance_reports" ("event_id");

-- ── The capability that gates it ────────────────────────────────────────────
--
-- `performance_report.file` is new in `packages/shared/src/capabilities.ts`, and
-- permission sets are STORED rows: adding it to the `operator_full` preset only
-- affects sets created from that preset from now on. Every permission set already
-- in the database — every existing event's operator — would hold no filing
-- authority at all, and the feature would appear broken on precisely the shows
-- that exist.
--
-- The predicate is `budget.edit`, not the set's name. A name is a label an
-- operator can retype; `budget.edit` is the capability the authorization ceiling
-- already restricts to the managing operator (host/co_host, `POOL_CAPABILITIES`),
-- so "the sets that carry it" is exactly "the sets that mean operator money
-- authority". A performer, agent or crew set can never carry it and therefore
-- never gains a filing capability here.
UPDATE "permission_sets"
SET "capabilities" = array_append("capabilities", 'performance_report.file')
WHERE 'budget.edit' = ANY("capabilities")
  AND NOT ('performance_report.file' = ANY("capabilities"));
