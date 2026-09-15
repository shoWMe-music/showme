import { Button, Card, Icon } from "@showme/design-system";
import { SettlementViewingAs } from "./SettlementViewingAs";
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
  currency,
}: { eventId: string; currency: string }) {
  const curation = useSettlementCuration(eventId);

  // Nothing to curate is not an empty state to draw — it is a card with no job.
  // Before the settlement is run there are no lines, and the tab above already
  // says so once.
  if (curation.isEmpty || curation.parties.length === 0) return null;

  const included = curation.chips.filter((chip) => chip.included);
  const withheld = curation.chips.filter((chip) => !chip.included);

  return (
    <>
      {/* The two halves of one decision, in the design's order: choose what they
          see, then look at what they will get. One party list feeds both, so the
          tabs can never offer a name the preview cannot show. */}
      <SettlementViewingAs eventId={eventId} parties={curation.parties} currency={currency} />
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
          <CardTitle
            subtitle={
              curation.selected
                ? `Click a line to include or withhold it from ${curation.selected.name}'s settlement. Only you see every figure by default.`
                : undefined
            }
          >
            Curate what each collaborator sees
          </CardTitle>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {curation.parties.map((party) => (
              <Button
                key={party.participantId}
                variant={
                  party.participantId === curation.selected?.participantId ? "primary" : "secondary"
                }
                onClick={() => curation.select(party.participantId)}
              >
                {party.name}
              </Button>
            ))}
          </div>
        </div>

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
            empty="Nothing yet — this party sees no figures at all."
            chips={included}
            isBusy={curation.isBusy}
            onToggle={curation.toggle}
          />
          <ChipList
            tone="withheld"
            title="Not shown to them"
            empty="They can see every line on this settlement."
            chips={withheld}
            isBusy={curation.isBusy}
            onToggle={curation.toggle}
          />
        </div>

        {/*
         * THE ONE THING THIS CARD CANNOT DO, said out loud.
         *
         * Curation widens the line list and never the totals — the waterfall stays
         * behind `budget.view` whatever is disclosed here. An operator who ticks
         * every line and expects the party to see the night's takings would
         * otherwise discover the limit by being contradicted by their own screen.
         */}
        <span
          className="muted"
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
        >
          <Icon name="eye-off" size={13} />
          Whatever you include, the event's totals stay yours — a collaborator never sees what the
          night took overall.
        </span>
      </Card>
    </>
  );
}

function ChipList({
  tone,
  title,
  empty,
  chips,
  isBusy,
  onToggle,
}: {
  tone: "included" | "withheld";
  title: string;
  empty: string;
  chips: CurationChip[];
  isBusy: boolean;
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
              disabled={isBusy}
              onClick={() => onToggle(chip.lineId)}
              // The whole chip is the control, and its label says which way it
              // will move — a bare × on an "included" chip and a bare + on a
              // withheld one is the prototype's shorthand, and it reads as
              // "delete this line" to anyone who has not been told otherwise.
              title={
                chip.included
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
                cursor: isBusy ? "progress" : "pointer",
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
