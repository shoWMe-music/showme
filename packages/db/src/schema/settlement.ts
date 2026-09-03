import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { deals } from "./deals";
import {
  budgetLineKind,
  budgetScope,
  settlementStatus,
  ticketingSource,
  transferState,
} from "./enums";
import { events, eventParticipants } from "./events";
import { profiles, representations } from "./identity";

/**
 * Module 4 — Budget & settlement. Two kinds of money: budget lines = external
 * cash (revenue `collected_by`, external costs `paid_by`); deals = inter-party
 * entitlements. Settlement reconciles them into per-participant "who owes whom"
 * transfers with `Σ net = 0` (PLAN.md "Reconciliation algorithm"). No escrow —
 * amounts are tracked, not moved; parties confirm receipt manually.
 */

/** A budget for an event — one shared budget for co-operators, plus optional private ones. */
export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    scope: budgetScope("scope").notNull().default("shared"),
    ownerProfileId: uuid("owner_profile_id").references(() => profiles.id), // set only for private
    // The planner's standing assumptions — today what the operator expects a
    // payment/ticketing provider to keep. NOT lines: nobody has paid this money,
    // and `reconcile()` reads lines as cash that actually moved (0015).
    planningAssumptions: jsonb("planning_assumptions"),
    version: integer("version").notNull().default(1), // optimistic lock (decisions #8)
  },
  (table) => [
    // Budgets are provisioned on demand, so two concurrent reads can race to
    // create the same one. These give the INSERT .. ON CONFLICT DO NOTHING
    // something to conflict on: at most one private budget per owning profile,
    // and at most one shared ledger per event.
    uniqueIndex("budgets_one_private_per_owner")
      .on(table.eventId, table.ownerProfileId)
      .where(sql`scope = 'private'`),
    uniqueIndex("budgets_one_shared_per_event").on(table.eventId).where(sql`scope = 'shared'`),
  ],
);

/**
 * A revenue or cost line. `collected_by` (revenue: who receives) / `paid_by`
 * (cost: who fronts) / `payee_participant_id` (cost: who the line is *for* — any
 * participant, e.g. a performer's hotel; NULL = external supplier) are what the
 * reconciliation reads.
 *
 * TWO WAYS A COST CAN NAME A DEAL, and they are opposite facts about the money —
 * which is why there are two columns and not one nullable `deal_id` plus a
 * convention:
 *
 * - **`deal_id` — the line IS that deal's own figure.** The guarantee typed into
 *   "Performer fee" while planning. It is a forecast of what the agreement will
 *   pay, not cash anybody moved, so the settlement takes the figure from the DEAL
 *   and drops the line at the engine boundary (`routes/settlement.ts`). Counting
 *   it would charge the pool once and entitle the payee again — the operator's
 *   residual short by the whole fee (design-handoff-budget-planner §6).
 * - **`attributed_deal_id` — a real third-party cost REPORTED UNDER that deal.**
 *   The 500 of catering booked to the headliner's night so the deal's true cost
 *   can be read off (2026-08 settlements meeting: *"all project costs assigned to
 *   specific deals, creating accountability for each agreement"*). Somebody was
 *   genuinely invoiced, so it is ordinary external cash: it lowers the pool and
 *   obeys `paid_by` / `payee_participant_id` / `cost_split` exactly as an
 *   untagged cost does. The settlement never reads this column at all — it is
 *   accountability, not arithmetic.
 *
 * Inferring the difference is what cannot be done. Both readings are legitimate
 * and the same operator wants both on the same event, so the line has to SAY
 * which it is, and the planner asks in words at the moment of assignment.
 */
export const budgetLines = pgTable(
  "budget_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    kind: budgetLineKind("kind").notNull(),
    // Provenance of a revenue line (decisions #15): `manual` or synced from a
    // ticketing provider (then `provider_ref` carries the external id).
    source: ticketingSource("source").notNull().default("manual"),
    providerRef: text("provider_ref"),
    label: text("label").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(), // minor units (money.md)
    currency: text("currency"), // defaults to the event's base_currency
    collectedBy: uuid("collected_by").references(() => eventParticipants.id),
    paidBy: uuid("paid_by").references(() => eventParticipants.id),
    payeeParticipantId: uuid("payee_participant_id").references(() => eventParticipants.id),
    costSplit: jsonb("cost_split"), // split rule (e.g. 50/50) when shared
    // The planner's breakdown behind `amount` (unit x quantity). `amount`
    // stays the authoritative figure settlement reads; this only remembers
    // how the operator arrived at it. NULL for a hand-entered line.
    details: jsonb("details"),
    // The deal whose OWN FIGURE this line is — settlement takes it from the deal
    // and ignores the line. See the two-columns note above.
    dealId: uuid("deal_id").references(() => deals.id),
    // The deal this cost is REPORTED UNDER — a real cost, still settled.
    attributedDealId: uuid("attributed_deal_id").references(() => deals.id),
    version: integer("version").notNull().default(1), // optimistic lock (decisions #8)
  },
  (table) => [
    index("budget_lines_budget_id_idx").on(table.budgetId),
    // A line is either a deal's own figure or a cost reported under it; it can
    // never be both, because the two say opposite things about whether the
    // settlement should count the money.
    check(
      "budget_lines_one_deal_sense",
      sql`num_nonnulls(${table.dealId}, ${table.attributedDealId}) <= 1`,
    ),
  ],
);

/**
 * One settlement per participant (the per-event view), OR one per representation
 * (the private agent↔performer commission settlement, decisions #14) — exactly
 * one of the two links is set, enforced by CHECK. `computed` holds the derived
 * E / collected / paid / net; `manual_overrides` the confirmed-cash corrections.
 */
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id").references(() => eventParticipants.id),
    representationId: uuid("representation_id").references(() => representations.id),
    status: settlementStatus("status").notNull().default("open"),
    computed: jsonb("computed"),
    manualOverrides: jsonb("manual_overrides"),
    // The locked FX rates live in the finalize snapshot (`data.lockedRates`) — a MAP,
    // since a multi-currency event locks several pair rates (money.md, #7).
    version: integer("version").notNull().default(1), // optimistic lock (decisions #8)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "settlements_exactly_one_subject",
      sql`num_nonnulls(${table.participantId}, ${table.representationId}) = 1`,
    ),
    index("settlements_event_id_idx").on(table.eventId),
  ],
);

/** A minimal `owed`/`paid`/`handled` transfer between two participants. */
export const settlementTransfers = pgTable(
  "settlement_transfers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    fromParticipant: uuid("from_participant")
      .notNull()
      .references(() => eventParticipants.id),
    toParticipant: uuid("to_participant")
      .notNull()
      .references(() => eventParticipants.id),
    amount: bigint("amount", { mode: "bigint" }).notNull(), // minor units (money.md)
    currency: text("currency"),
    // Set → this is a PRIVATE agent↔performer commission transfer (decisions #14);
    // the operator never sees it. Null → an ordinary event settlement transfer.
    representationId: uuid("representation_id").references(() => representations.id),
    state: transferState("state").notNull().default("owed"),
    version: integer("version").notNull().default(1), // optimistic lock (decisions #8)
  },
  (table) => [index("settlement_transfers_event_id_idx").on(table.eventId)],
);

/** A comment on a settlement, from an on- or off-platform party. */
export const settlementComments = pgTable("settlement_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  partyParticipantId: uuid("party_participant_id").references(() => eventParticipants.id),
  authorEmail: text("author_email"),
  authorName: text("author_name"),
  /**
   * WHICH part of the document the comment is about — `event`, `schedule`,
   * `riders`, `budget`, `deal` or `settlement` (the share viewer's sections,
   * which are the share capabilities themselves). NULL for a comment on the
   * settlement as a whole, which is every row written before this column existed.
   *
   * A column and not a prefix on `message`: the old app posted `"[Agreement] …"`
   * so the operator's inbox could guess what a comment was about, and a guess
   * parsed out of user-supplied text is not a field — a recipient who types
   * "[Settlement] " themselves lands wherever the parser puts them.
   */
  section: text("section"),
  /**
   * The exact FIGURE this comment is about, when it is about one.
   *
   * `section` above narrows a comment to a part of the document; this narrows it
   * to a row. ClickUp `86cbcn1ue`: *"The option for collaborators to comment on a
   * specific field."* The gap it closes is not politeness — `EventSettlement`'s
   * own note says that answering a comment MEANS changing a figure, and a remark
   * floating in a general thread makes the reader hunt for which one.
   *
   * A COLUMN, for the same reason `section` is one rather than a `"[Budget] "`
   * prefix on the message: the old app parsed that guess out of user-supplied
   * text, and a recipient who types the prefix themselves lands wherever the
   * parser puts them. Encoding a line id into `section` would be the same mistake
   * with a longer string.
   *
   * Nullable, and NULL on every row written before this existed — a comment on
   * the settlement as a whole, which stays a legitimate and common thing to say.
   * `set null` on delete rather than cascade: deleting the line somebody
   * questioned must not delete the question, which is usually the moment it
   * becomes most worth reading.
   */
  settlementLineId: uuid("settlement_line_id").references((): AnyPgColumn => settlementLines.id, {
    onDelete: "set null",
  }),
  message: text("message").notNull(),
  attachments: jsonb("attachments"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A party's approval of their settlement (kept versioned per the 2026-07 decision). */
export const settlementApprovals = pgTable("settlement_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  partyParticipantId: uuid("party_participant_id")
    .notNull()
    .references(() => eventParticipants.id),
  approved: boolean("approved").notNull().default(false),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});

/** An immutable legal record, written only when a settlement is finalized. */
export const settlementSnapshots = pgTable("settlement_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  data: jsonb("data").notNull(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The budget as it stood at a moment in the settlement's life — the record that
 * makes planned-vs-actual answerable after the fact (decisions.md #16.8, feeding
 * the #16.9 analytics surface).
 *
 * WHY THIS EXISTS AT ALL. `budgets` / `budget_lines` are edited IN PLACE from
 * forecast to fact: the planner types 200 tickets x 250 into a line's `details`
 * before the show, and after it the same row is corrected to the 168 that
 * actually sold (the 2026-08 settlements meeting requires exactly that — every
 * collaborator enters real revenue and cost BEFORE the settlement is generated).
 * Nothing keeps the earlier figure, so "did we beat the plan?" is unanswerable
 * the moment somebody saves. #16.8's one-line summary of that is "a budget
 * disappears once it becomes a settlement".
 *
 * ALONGSIDE `settlement_snapshots`, NOT INSIDE IT — the wording #16.8 itself
 * uses, and for three reasons that are not stylistic:
 *  - `settlement_snapshots` is written ONLY at finalize and its `version` IS the
 *    finalization sequence (`routes/settlement.ts` numbers the next freeze from
 *    `max(version)`). Capturing a budget at compute would have to write rows into
 *    that table for events that are never finalized, which would break both the
 *    table's meaning and its numbering.
 *  - The cardinalities differ. A budget is captured whenever it MOVES during the
 *    settlement conversation; a settlement is frozen once per finalize.
 *  - The access rule differs, and this is the one that matters. A
 *    `settlement_snapshots` row is served per party through `serializeSettlement`,
 *    which redacts the pool for anyone without pool visibility. A budget snapshot
 *    is the whole night's money — every takings line, every cost, who collected
 *    what — and there is no per-party reading of it. A separate table means "who
 *    may read this" has ONE answer for the whole table (`budget.view`, which
 *    `POOL_CAPABILITIES` makes ungrantable to any arm's-length party) instead of
 *    a per-column rule someone must remember.
 *
 * Rows are APPEND-ONLY and never updated. That is what makes the three
 * denormalized totals below safe, and it is the difference from migration 0023's
 * rule against storing what can be derived: the drift 0023 guards against comes
 * from an UPDATE that touches a summary and not the thing it summarises, and
 * there is no update path here at all.
 */
export const budgetSnapshots = pgTable(
  "budget_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** 1, 2, 3 … per event. **Version 1 is the plan of record** — see below. */
    version: integer("version").notNull(),
    /** `compute` or `finalize` — which act captured it. */
    reason: text("reason").notNull(),
    /** Set only on a `finalize` capture: the legal freeze this budget produced. */
    settlementSnapshotId: uuid("settlement_snapshot_id").references(() => settlementSnapshots.id, {
      onDelete: "cascade",
    }),
    /** The currency the three totals below are stated in (the event's base). */
    baseCurrency: text("base_currency").notNull(),
    plannedRevenue: bigint("planned_revenue", { mode: "bigint" }).notNull(), // minor units
    plannedCosts: bigint("planned_costs", { mode: "bigint" }).notNull(), // minor units
    /** `plannedRevenue - plannedCosts`, stored so #16.9 can sort on it. */
    plannedPool: bigint("planned_pool", { mode: "bigint" }).notNull(), // minor units
    /** The frozen budgets and their lines, plus the FX rates the totals used. */
    data: jsonb("data").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("budget_snapshots_one_version_per_event").on(table.eventId, table.version),
    index("budget_snapshots_event_id_idx").on(table.eventId),
  ],
);

/**
 * THE SETTLEMENT'S OWN COPY OF THE BUDGET — the real numbers.
 *
 * A budget is a forecast: it says what the night was expected to take and cost,
 * and it goes on being edited as a planning document. A settlement is the record
 * of what actually happened. The two must not be the same rows, and the product
 * owner's rule (2026-08-27) is exact: **the settlement has a copy of the budget,
 * and the budget is never changed from the settlement.**
 *
 * The engine used to read `budget_lines` live, which collapsed that distinction —
 * typing an actual cost meant editing the forecast, and the forecast was then
 * gone. So `reconcile()` now reads THESE rows, and the planner keeps its own.
 *
 * **Sealed at the copy.** The copy is taken once, when the settlement is first
 * run, and never looks at the budget again (the product owner's choice among the
 * three drift behaviours). A budget edited afterwards is a forecast being revised
 * after the fact and has nothing to say about a night that already happened.
 *
 * `origin_budget_line_id` remembers which forecast line a row came from — that
 * is what planned-vs-actual pairs on — and is NULL for a line first entered in
 * the settlement, which is the honest answer to "what was this budgeted at?":
 * nothing, it was not foreseen.
 *
 * Keyed on the EVENT, not on a settlement row, for the same reason
 * `budget_snapshots` is: there is one night's cash, and `settlements` holds one
 * row per party to it.
 */
export const settlementLines = pgTable(
  "settlement_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** The forecast line this was copied from. NULL = added in the settlement. */
    originBudgetLineId: uuid("origin_budget_line_id").references(() => budgetLines.id, {
      onDelete: "set null",
    }),
    kind: budgetLineKind("kind").notNull(),
    source: ticketingSource("source").notNull().default("manual"),
    providerRef: text("provider_ref"),
    label: text("label").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(), // minor units (money.md)
    currency: text("currency"),
    collectedBy: uuid("collected_by").references(() => eventParticipants.id),
    paidBy: uuid("paid_by").references(() => eventParticipants.id),
    payeeParticipantId: uuid("payee_participant_id").references(() => eventParticipants.id),
    costSplit: jsonb("cost_split"),
    details: jsonb("details"),
    dealId: uuid("deal_id").references(() => deals.id),
    attributedDealId: uuid("attributed_deal_id").references(() => deals.id),
    version: integer("version").notNull().default(1), // optimistic lock (decisions #8)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("settlement_lines_event_id_idx").on(table.eventId),
    index("settlement_lines_origin_idx").on(table.originBudgetLineId),
    // The same rule the forecast carries: a line is either a deal's own figure or
    // a cost reported under it, never both.
    check(
      "settlement_lines_one_deal_sense",
      sql`num_nonnulls(${table.dealId}, ${table.attributedDealId}) <= 1`,
    ),
  ],
);
