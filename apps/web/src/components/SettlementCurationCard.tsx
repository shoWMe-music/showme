import { Card, Icon } from "@showme/design-system";
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
export function SettlementCurationCard({ eventId }: { eventId: string }) {
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
          <CardTitle
            subtitle={
              curation.selected
                ? `Click a line to include or withhold it from ${curation.selected.name}'s settlement. Only you see every figure by default.`
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
    </Card>
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
