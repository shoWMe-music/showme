import { Icon, type IconName, Select } from "@showme/design-system";
import type {
  BudgetAttributionOption,
  BudgetDealOption,
  CostBearing,
  CostDealLink,
} from "./useBudgetEditor";
import { NO_DEAL_LINK } from "./useBudgetEditor";

/**
 * WHO HANDLED THIS MONEY — the strip under every line in the Budget Planner.
 *
 * The 2026-08 settlements meeting names this twice, as a decision and again as a
 * next step (01:27:49, 01:29:46): *"Every revenue stream carries a collected-by
 * designation… A multi-selector defines who pays a cost and who receives revenue;
 * both settle after the event."* The reason is stated plainly at 01:24:48 —
 * **the system cannot know who holds the cash.** Until this existed the planner
 * attributed every line to whoever typed it, so a settlement between a venue that
 * took the door and a promoter that paid the band was computed from a fiction.
 *
 * Presentational and deliberately dumb: it renders selects and emits ids. Which
 * parties exist, what the rules mean and what gets written are the hook's
 * (`useBudgetEditor`) and the engine's (`packages/settlement`).
 *
 * ---
 *
 * **THE TWO COST QUESTIONS, AND WHY THEY ARE TWO.** Reported 2026-08-31: *"the
 * 'born by' text and dropdown menu is very confusing. What's the difference
 * between paid by and born by…"* The distinction is real and load-bearing —
 * `budget_lines.paid_by` is who the money physically left, and
 * `payee_participant_id` / `cost_split` are who it finally comes out of, which is
 * how a deductible works at all (the settlement skill: a cost `paid_by = venue`
 * assigned to the band's deal lowers `E_band` and raises `P_venue`). Collapsing
 * them into one field would delete the deductible.
 *
 * So the fix is legibility, not merging. Three things carry it, in order of how
 * little space they cost:
 *   1. **Captions that ask a question** — "Pays it" / "Carries it" rather than
 *      two past participles that sound like synonyms.
 *   2. **A description under every option, in the menu**, where the reader is
 *      actually deciding — free vertically, because the menu is a popover.
 *   3. **A sentence on the row, but only when the two answers DIFFER.** When the
 *      event carries its own cost there is nothing surprising to explain; when it
 *      is deducted from one party's settlement there very much is.
 * `CostAttributionLegend` states the pair once at the top of the Costs card, so
 * the row-level machinery never has to define its terms from scratch.
 */

const SHARED_BEARING_VALUE = "__shared__";
const SPLIT_BEARING_VALUE = "__split__";
const NO_DEAL_VALUE = "__none__";

/**
 * The deal selector offers each deal TWICE, once per sense, so the two are picked
 * apart rather than set by a second control the operator might never touch.
 * These prefixes are how one flat `<Select>` carries a two-part answer.
 */
const DEAL_FIGURE_PREFIX = "figure:";
const ATTRIBUTED_PREFIX = "under:";

function dealLinkFromOption(value: string): CostDealLink {
  if (value.startsWith(DEAL_FIGURE_PREFIX)) {
    return { kind: "deal_figure", dealId: value.slice(DEAL_FIGURE_PREFIX.length) };
  }
  if (value.startsWith(ATTRIBUTED_PREFIX)) {
    return { kind: "attributed", dealId: value.slice(ATTRIBUTED_PREFIX.length) };
  }
  return NO_DEAL_LINK;
}

function dealOptionValue(link: CostDealLink): string {
  if (link.kind === "deal_figure") return `${DEAL_FIGURE_PREFIX}${link.dealId}`;
  if (link.kind === "attributed") return `${ATTRIBUTED_PREFIX}${link.dealId}`;
  return NO_DEAL_VALUE;
}

const stripStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  paddingLeft: 2,
} as const;

const captionStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 9.5,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--dim)",
  whiteSpace: "nowrap",
} as const;

/**
 * One captioned control on the strip.
 *
 * It used to be a fixed pixel width, and that was the whole of the "unreadable
 * dropdowns" report: 170px of trigger holding `“Lantern Hall” — Operator`, which
 * the trigger's own `text-overflow: ellipsis` cut to `“Lantern Hall” —…`. The
 * option text is now split into a label and a description (so nothing has to fit
 * on one line at all), and the control GROWS into whatever the row has spare —
 * `flex: 1 1 <basis>` with `minWidth: 0`, which is also what lets the strip wrap
 * cleanly at 390px instead of forcing the page sideways.
 */
function Field({
  caption,
  basis,
  children,
}: { caption: string; basis: number; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flex: `1 1 ${basis}px`,
        minWidth: 0,
      }}
    >
      <span style={captionStyle}>{caption}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </span>
  );
}

/**
 * A floor for the MENU's width, independent of the trigger it hangs off.
 *
 * The trigger is now elastic, so on a narrow column it can be genuinely small —
 * and a menu that inherited that width would be the truncation bug moved from the
 * closed control into the open one.
 */
const MENU_WIDTH = 280;

/** The party each option names, with its event role underneath rather than glued on. */
function participantOptions(participants: BudgetAttributionOption[]) {
  return participants.map((party) => ({
    value: party.id,
    label: party.label,
    description: party.roleLabel,
  }));
}

/**
 * What an UNATTRIBUTED row says.
 *
 * It used to say the planner's own name, because every selector rendered
 * `value || fallbackParticipantId` — so a row nobody had touched looked exactly
 * like a row somebody had decided, and the reported symptom was *"why is paid by
 * always just the operator"*. Nothing was stored; the screen was answering its
 * own question.
 *
 * The default itself is real and stays: `useBudgetEditor`'s flush writes the
 * planning operator's participant id for any row left unset, which it must —
 * `assertBudgetLinesAttributeTheirCash` refuses a compute outright on a revenue
 * line with no `collected_by` or a cost with no `paid_by` ("it raises the pool
 * while no participant holds the cash"). So the honest rendering is a
 * PLACEHOLDER, in the muted placeholder treatment, that names the default as a
 * default: unset on the screen, decided in the write, and the reader can see
 * which is which.
 */
function defaultsToPlaceholder(
  participants: BudgetAttributionOption[],
  fallbackParticipantId: string | null,
): string {
  const fallback = participants.find((party) => party.id === fallbackParticipantId);
  return fallback ? `Defaults to you — ${fallback.label}` : "Defaults to you";
}

export interface RevenueAttributionProps {
  participants: BudgetAttributionOption[];
  /** The chosen participant id, or "" for "whoever is planning" (the caller). */
  value: string;
  /**
   * Who an unset row will be attributed to when it is written. Used ONLY to word
   * the placeholder — never as the rendered value, which is the display bug this
   * prop used to cause.
   */
  fallbackParticipantId: string | null;
  onChange: (participantId: string) => void;
  /** Names the row in the accessible label — "Collected by, for Advance tickets". */
  rowLabel: string;
}

/** One select: the party who RECEIVES a revenue line. */
export function RevenueAttribution({
  participants,
  value,
  fallbackParticipantId,
  onChange,
  rowLabel,
}: RevenueAttributionProps) {
  if (participants.length === 0) return null;
  return (
    <div style={stripStyle}>
      <Field caption="Collected by" basis={200}>
        <Select
          value={value}
          placeholder={defaultsToPlaceholder(participants, fallbackParticipantId)}
          menuWidth={MENU_WIDTH}
          onChange={onChange}
          options={participantOptions(participants)}
          searchable={participants.length > 6}
          aria-label={`Collected by, for ${rowLabel}`}
        />
      </Field>
    </div>
  );
}

export interface CostAttributionProps {
  participants: BudgetAttributionOption[];
  deals: BudgetDealOption[];
  paidBy: string;
  /** Who an unset row defaults to — the placeholder's wording, never the value. */
  fallbackParticipantId: string | null;
  bearing: CostBearing;
  dealLink: CostDealLink;
  onPaidByChange: (participantId: string) => void;
  onBearingChange: (bearing: CostBearing) => void;
  onEditSplit: () => void;
  onDealLinkChange: (link: CostDealLink) => void;
  rowLabel: string;
}

/**
 * Three selects: who FRONTED the cash, who ultimately CARRIES it, and how the row
 * relates to a deal.
 *
 * The first two are separate on purpose (see the module note and `CostBearing`):
 * the operator pays the marketing invoice, and the contract may still split it
 * 50/50. Picking "Split…" hands the question to `CostSplitModal` rather than
 * trying to express percentages in a dropdown.
 */
export function CostAttribution({
  participants,
  deals,
  paidBy,
  fallbackParticipantId,
  bearing,
  dealLink,
  onPaidByChange,
  onBearingChange,
  onEditSplit,
  onDealLinkChange,
  rowLabel,
}: CostAttributionProps) {
  if (participants.length === 0) return null;

  const bearingValue =
    bearing.kind === "participant"
      ? bearing.participantId
      : bearing.kind === "split"
        ? SPLIT_BEARING_VALUE
        : SHARED_BEARING_VALUE;

  const chooseBearing = (value: string) => {
    if (value === SHARED_BEARING_VALUE) return onBearingChange({ kind: "shared" });
    if (value === SPLIT_BEARING_VALUE) return onEditSplit();
    onBearingChange({ kind: "participant", participantId: value });
  };

  // A row that IS a deal's own figure is a forecast, not cash: the settlement
  // takes it from the deal and never reads the line. Who fronted it and who
  // carries it are therefore questions with no answer, and leaving the two selects
  // on the row would offer settings nothing applies — the dead-affordance problem
  // that made the old "Cost split: 100% split" readout wrong in the first place.
  //
  // A cost merely REPORTED UNDER a deal keeps both, because it is real money
  // somebody fronted and somebody carries. That difference is the whole reason the
  // two senses are separate.
  const isDealFigure = dealLink.kind === "deal_figure";

  return (
    <>
      <div style={stripStyle}>
        {!isDealFigure && (
          <Field caption="Pays it" basis={190}>
            <Select
              value={paidBy}
              placeholder={defaultsToPlaceholder(participants, fallbackParticipantId)}
              menuWidth={MENU_WIDTH}
              onChange={onPaidByChange}
              options={participantOptions(participants)}
              searchable={participants.length > 6}
              aria-label={`Pays it — who the invoice goes out from, for ${rowLabel}`}
            />
          </Field>
        )}
        {!isDealFigure && (
          <Field caption="Carries it" basis={200}>
            <Select
              value={bearingValue}
              menuWidth={MENU_WIDTH}
              onChange={chooseBearing}
              options={[
                {
                  value: SHARED_BEARING_VALUE,
                  label: "The event",
                  description: "Comes off the pool, so every share is smaller by it.",
                },
                ...participants.map((party) => ({
                  value: party.id,
                  label: party.label,
                  description: `Deducted from ${party.label}'s settlement — their money in the end.`,
                })),
                {
                  value: SPLIT_BEARING_VALUE,
                  label: "Split between parties…",
                  description: "Shared by percentage, set in the next dialog.",
                },
              ]}
              searchable={participants.length > 6}
              aria-label={`Carries it — whose money it finally comes out of, for ${rowLabel}`}
            />
          </Field>
        )}
        {!isDealFigure && bearing.kind === "split" && (
          <button type="button" onClick={onEditSplit} style={splitPillStyle}>
            <Icon name="chevron-right" size={11} />
            {splitSummary(bearing.shares, participants)}
          </button>
        )}
        {deals.length > 0 && (
          // EACH DEAL APPEARS TWICE, and the two entries are the two things naming a
          // deal can mean. One says the row IS that deal's figure written down early
          // — the settlement takes it from the deal and never counts the line. The
          // other says a real cost is being reported under the deal — the settlement
          // counts it like any other. Offering one entry per deal would force the
          // planner to guess, and either guess is somebody's residual out by the
          // whole amount; the sentence under the row then says which was chosen.
          <Field caption="Deal" basis={220}>
            <Select
              value={dealOptionValue(dealLink)}
              menuWidth={MENU_WIDTH}
              onChange={(value) => onDealLinkChange(dealLinkFromOption(value))}
              options={[
                { value: NO_DEAL_VALUE, label: "Not tied to a deal" },
                ...deals.flatMap((deal) => [
                  {
                    value: `${DEAL_FIGURE_PREFIX}${deal.id}`,
                    label: deal.name,
                    description: "This IS the deal's figure — a forecast, never settled twice.",
                  },
                  {
                    value: `${ATTRIBUTED_PREFIX}${deal.id}`,
                    label: deal.name,
                    description: "A real cost reported under it — still lowers the pool.",
                  },
                ]),
              ]}
              searchable={deals.length > 3}
              aria-label={`How this cost relates to a deal, for ${rowLabel}`}
            />
          </Field>
        )}
      </div>
      {!isDealFigure && (
        <CostBearingNote bearing={bearing} participants={participants} paidBy={paidBy} />
      )}
    </>
  );
}

/**
 * PAYS IT AND CARRIES IT, STATED ONCE.
 *
 * A definition repeated under every row is noise; a definition available nowhere
 * is the report this session is answering. So it sits at the head of the Costs
 * card — read once, applies to all of them.
 */
export function CostAttributionLegend() {
  return (
    <div style={legendStyle}>
      <span>
        <strong>Pays it</strong> is who the invoice actually goes out from.{" "}
        <strong>Carries it</strong> is whose money it comes out of in the end. Usually the same
        party — a contract is what makes them different.
      </span>
    </div>
  );
}

/**
 * The outcome sentence, ON A ROW WHERE THE TWO ANSWERS DIFFER.
 *
 * Deliberately silent for the ordinary case. A cost the event carries needs no
 * explanation beyond the caption and the legend, and printing one under all six
 * standing headings is exactly the padding the same report complained about. A
 * cost deducted from one party's settlement is the case a reader gets wrong, so
 * that is the case that gets a sentence — the `DealAssignmentNote` pattern, in
 * the same treatment, for the same reason.
 */
function CostBearingNote({
  bearing,
  participants,
  paidBy,
}: {
  bearing: CostBearing;
  participants: BudgetAttributionOption[];
  paidBy: string;
}) {
  if (bearing.kind === "shared") return null;
  const payer = participants.find((party) => party.id === paidBy)?.label ?? "Whoever pays it";
  if (bearing.kind === "split") {
    return (
      <NoteLine icon="arrow-right">
        {payer} pays it, and it is then deducted from each party's settlement:{" "}
        {splitSummary(bearing.shares, participants)}.
      </NoteLine>
    );
  }
  const bearer = participants.find((party) => party.id === bearing.participantId)?.label;
  if (!bearer) return null;
  return (
    <NoteLine icon="arrow-right">
      {payer} pays it, and it is deducted from {bearer}'s settlement — so {bearer} carries it, not
      the event pool.
    </NoteLine>
  );
}

/** "Venue 60% · Marlo Vance 40%" — the split, short enough to sit on the row. */
export function splitSummary(
  shares: Record<string, number>,
  participants: BudgetAttributionOption[],
): string {
  const named = Object.entries(shares).map(([participantId, basisPoints]) => {
    const party = participants.find((option) => option.id === participantId);
    return `${party?.label ?? "Participant"} ${(basisPoints / 100).toFixed(0)}%`;
  });
  return named.length > 0 ? named.join(" · ") : "No shares set";
}

const splitPillStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 11,
  padding: "3px 9px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "var(--shape-fill)",
  color: "var(--muted)",
  cursor: "pointer",
} as const;

const legendStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: 7,
  fontSize: 11.5,
  lineHeight: 1.5,
  color: "var(--muted)",
} as const;

/** The house treatment for a one-line explanation under a budget row. */
function NoteLine({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11.5,
        color: "var(--dim)",
        paddingLeft: 2,
      }}
    >
      <Icon name={icon} size={12} />
      {children}
    </div>
  );
}

/**
 * The sentence under a cost that names a deal — what the choice above it DID.
 *
 * Two selector entries that differ by six words are not enough on their own; what
 * makes the difference legible is spelling out the consequence, on the row, at the
 * moment it is chosen. One of these says the money is taken from the deal, the
 * other says the money still comes out of the night. An operator who read the
 * control as a mere label would otherwise book real catering against a deal and
 * watch 500 leave the settlement without a word.
 */
export function DealAssignmentNote({ link, dealName }: { link: CostDealLink; dealName: string }) {
  if (link.kind === "none") return null;
  return (
    <NoteLine icon="link">
      {link.kind === "deal_figure"
        ? `Forecast only — this IS the figure in “${dealName}”. The settlement takes it from the deal, so it is never counted twice and never charged to the event.`
        : `A real cost of the event, reported under “${dealName}”. It still lowers the settlement pool, exactly like an untagged cost.`}
    </NoteLine>
  );
}
