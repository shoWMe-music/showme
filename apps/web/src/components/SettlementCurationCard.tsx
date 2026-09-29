import { Card, Icon } from "@showme/design-system";
import { possessiveOf } from "../lib/format";
import { CardTitle, Eyebrow } from "./primitives";
import { type CurationChip, useSettlementCuration } from "./useSettlementCuration";

/**
 * CURATE WHAT EACH COLLABORATOR SEES — Ran's §5 card, built from the rendered
 * prototype (`claude-prototype/ran-2026-09-10/renders/proto-settlement-full.png`).
 *
 * A tab per party, then two lists: what is in their settlement, and what is not.
 * A chip moves between them on click.
 *
 * **Click, not drag.** The design says *"drag a line between the two lists — or
 * click it"*, and click is the half that is the contract: it works on a phone, it
 * works from a keyboard, and it is the affordance a screen reader can announce.
 * Drag would be a nicety on top of a working control, and is deliberately not
 * built yet rather than half-built.
 *
 * Operator-only, and not by hiding: the card is rendered on a tab only a holder of
 * `settlement.edit` reaches, and the API refuses the write to anyone else (403,
 * asserted in `settlement.test.ts`). A curated party never sees this card, and —
 * more to the point — never learns from their own settlement that it exists.
 */
export function SettlementCurationCard({
  eventId,
  locked = false,
}: {
  eventId: string;
  /**
   * THE NIGHT'S FIGURES ARE FROZEN, so there is nothing left to curate (QA sweep run 17, QA17-5).
   *
   * `PUT …/settlement/curation` calls `assertNotFinalized` unconditionally, so on a finalized
   * settlement **every chip on this card 409s**. The sweep found the card fully interactive —
   * four party tabs, six line chips, each captioned *"Include this line in their settlement"* —
   * on the same screen where Recalculate, Finalize, Send for review and Add revision had all
   * correctly withdrawn and a green *"Finalized — figures and rates locked"* pill stood in their
   * place. The toast that came back was honest; NEVER OFFER WHAT THE API WILL REFUSE is the rule
   * the rest of this screen was rebuilt around, and an honest refusal is not a substitute for it.
   *
   * A prop rather than a second read of the settlement inside this card: the caller already holds
   * the answer (`settlement.isFinalized`, which is `wasFinalized` OR a frozen own row), and a
   * component deriving a rule the screen above it has already decided is how two copies disagree.
   */
  locked?: boolean;
}) {
  const curation = useSettlementCuration(eventId);

  // Nothing to curate is not an empty state to draw — it is a card with no job.
  // Before the settlement is run there are no lines, and the tab above already
  // says so once.
  if (curation.isEmpty || curation.parties.length === 0) return null;

  const included = curation.chips.filter((chip) => chip.included);
  const withheld = curation.chips.filter((chip) => !chip.included);

  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {/* The title block takes the space that is left; the chips keep theirs.
            Without the basis the title grew to the full row and pushed the chips
            onto a line of their own, which is not where the design puts them. */}
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          {/*
            IT SAYS WHICH LIST IT IS TALKING ABOUT, and the second sentence used to not.
 
            It read *"Only you see every figure by default"*, which is true of THIS settlement's line
            list and false of the night: the Overview tab of the same workspace tells the same
            co-host *"the list leaves out 5 parties on this night whose settlements are not shared
            with you"*. Consistent in the model's vocabulary, contradictory in English (QA sweep run
            13) — and "every figure" is the phrase that makes it sound like a claim about the night.
 
            `included` is `line.visibleTo.includes(selected.participantId)` (`useSettlementCuration`),
            so the honest sentence is about the party's COPY, which is the thing the click changes.
          */}
          <CardTitle
            subtitle={
              curation.selected
                ? `Click a line to include or withhold it from ${possessiveOf(curation.selected.name)} settlement. A withheld line is not on their copy.`
                : undefined
            }
          >
            Curate what each collaborator sees
          </CardTitle>
        </div>
        {/* SMALL OUTLINE CHIPS beside the title, as the design draws them. Filled
            buttons on their own row read as the card's primary action, which they
            are not — they choose whose view you are editing.

            `flexShrink: 0` used to be here and was a 79px page overflow at 390px
            (QA7-8). A flex item that refuses to shrink takes its MAX-content width —
            four nowrap buttons, 426px — and keeps it even after the outer row has
            wrapped it onto a line of its own, so the `flexWrap` on this very element
            never got a chance to act: the box was never narrowed. Shrinking restored,
            and `minWidth: 0` removes the min-content floor underneath it — the same
            fix, for the same reason, as the `minmax(0, Nfr)` note in
            `InvoiceLedgerTable`. Remove the floor; do not buy pixels.

            The chips still sit beside the title on a wide screen: what puts them
            there is the title's own `flex: 1 1 280px` basis, not this. */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
          {curation.parties.map((party) => {
            const active = party.participantId === curation.selected?.participantId;
            return (
              <button
                key={party.participantId}
                type="button"
                aria-pressed={active}
                onClick={() => curation.select(party.participantId)}
                style={{
                  padding: "5px 11px",
                  borderRadius: 8,
                  border: `1px solid ${active ? "var(--brand-red)" : "var(--border)"}`,
                  background: active
                    ? "color-mix(in srgb, var(--brand-red) 9%, transparent)"
                    : "var(--surface)",
                  color: active ? "var(--brand-red)" : "var(--text)",
                  font: "inherit",
                  fontSize: 12.5,
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                {party.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* IT SAYS WHY, rather than leaving six greyed chips to be read as a fault. The wording is the
          screen's own — the pill above these lists says "Finalized — figures and rates locked". */}
      {locked && (
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
          These figures are finalized, so what each party sees is frozen with them. The settlement
          each of them received is the one below.
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
          gap: 12,
          alignItems: "start",
        }}
      >
        <ChipList
          tone="included"
          title="In their settlement"
          empty="Nothing yet: this party sees no figures at all."
          chips={included}
          isBusy={curation.isBusy}
          locked={locked}
          onToggle={curation.toggle}
        />
        <ChipList
          tone="withheld"
          title="Not shown to them"
          empty="They can see every line on this settlement."
          chips={withheld}
          isBusy={curation.isBusy}
          locked={locked}
          onToggle={curation.toggle}
        />
      </div>
    </Card>
  );
}

function ChipList({
  tone,
  title,
  empty,
  chips,
  isBusy,
  locked,
  onToggle,
}: {
  tone: "included" | "withheld";
  title: string;
  empty: string;
  chips: CurationChip[];
  isBusy: boolean;
  locked: boolean;
  onToggle: (lineId: string) => void;
}) {
  const accent = tone === "included" ? "var(--brand-green, #3db88b)" : "var(--border-strong)";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 14,
        borderRadius: 12,
        border: `1px dashed ${accent}`,
        minWidth: 0,
      }}
    >
      <Eyebrow>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name={tone === "included" ? "check" : "eye-off"} size={12} />
          {title}
        </span>
      </Eyebrow>
      {chips.length === 0 ? (
        <span className="muted" style={{ fontSize: 12.5 }}>
          {empty}
        </span>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {chips.map((chip) => (
            <button
              key={chip.lineId}
              type="button"
              disabled={isBusy || locked}
              onClick={() => onToggle(chip.lineId)}
              // The whole chip is the control, and its label says which way it
              // will move — a bare × on an "included" chip and a bare + on a
              // withheld one is the prototype's shorthand, and it reads as
              // "delete this line" to anyone who has not been told otherwise.
              title={
                locked
                  ? "These figures are finalized — what each party sees is frozen with them."
                  : chip.included
                    ? "Withhold this line from them"
                    : "Include this line in their settlement"
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 10px",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--text)",
                font: "inherit",
                fontSize: 12.5,
                cursor: locked ? "not-allowed" : isBusy ? "progress" : "pointer",
                opacity: locked ? 0.55 : 1,
                maxWidth: "100%",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {chip.label}
              </span>
              <Icon name={chip.included ? "x" : "plus"} size={12} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
