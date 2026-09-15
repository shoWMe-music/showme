import { useGetApiV1EventsIdSettlementPreview } from "@showme/api-client";
import { Avatar, Badge, Card, Icon, Select } from "@showme/design-system";
import { useState } from "react";
import { formatMoney } from "../lib/format";
import { Eyebrow } from "./primitives";
import { initialsOf } from "./settlementDocument";
import type { CuratedParty } from "./useSettlementCuration";

/**
 * VIEWING AS — the design's control, answered by the server.
 *
 * The prototype simulates this in the browser: it filters a list the page already
 * holds and re-renders. That is the one thing this control must not do. The
 * question an operator asks before pressing send is *"what will actually reach
 * them"*, and only the thing that decides it can answer — so this asks the API for
 * the party's view, through the same filter the party's own read runs
 * (`GET …/settlement/preview`). A curation bug shows up here instead of hiding
 * behind a second implementation of the rule.
 *
 * It previews the LINE LIST, which is what curation governs, and says in words
 * what the other two rules are: their own figure is always theirs to see, and the
 * event's totals never are. Re-rendering the whole page as them would mean
 * restating both of those rules in a second place — and a preview that disagrees
 * with the document is worse than no preview.
 */
export function SettlementViewingAs({
  eventId,
  parties,
  currency,
}: { eventId: string; parties: CuratedParty[]; currency: string }) {
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = parties.find((party) => party.participantId === viewingId) ?? null;
  const preview = useGetApiV1EventsIdSettlementPreview(
    eventId,
    { participantId: viewing?.participantId ?? "" },
    // Nothing is fetched until a party is chosen: an operator who never opens this
    // asks the server nothing, and the empty-string id never reaches a request.
    { query: { enabled: viewing != null } },
  );

  if (parties.length === 0) return null;

  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar initials={viewing ? initialsOf(viewing.name) : "YOU"} size={32} />
          <div>
            <Eyebrow>Viewing as</Eyebrow>
            <div style={{ fontWeight: 600 }}>
              {viewing ? `${viewing.name} · ${viewing.role}` : "You — the operator"}
            </div>
          </div>
        </div>
        {/* A SELECT, as the design draws it — "Operator (you)" in a control on
            the right. A row of buttons was the first attempt and it grows with
            the bill: five parties made a second line of chrome above the card
            that actually does the work. */}
        <div style={{ width: 240, maxWidth: "100%" }}>
          <Select
            value={viewingId ?? ""}
            onChange={(next) => setViewingId(next === "" ? null : next)}
            options={[
              { value: "", label: "Operator (you)" },
              ...parties.map((party) => ({
                value: party.participantId,
                label: `${party.name} — ${party.role}`,
              })),
            ]}
            aria-label="View this settlement as another party"
          />
        </div>
      </div>

      {viewing && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: 14,
            borderRadius: 12,
            background: "var(--elevated, var(--surface))",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
            <Icon name="eye" size={15} />
            This is what {viewing.name} sees. Figures are read-only for them; they can comment on
            any line and approve or request changes.
          </span>
          {preview.isPending ? (
            <span className="muted" style={{ fontSize: 12.5 }}>
              Asking…
            </span>
          ) : preview.isError ? (
            <span className="muted" style={{ fontSize: 12.5 }}>
              Couldn't load their view.
            </span>
          ) : (preview.data?.lines ?? []).length === 0 ? (
            <span className="muted" style={{ fontSize: 12.5 }}>
              No lines at all. They see their own settlement figure and the rule behind it, and
              nothing else.
            </span>
          ) : (
            (preview.data?.lines ?? []).map((line) => (
              <div
                key={line.id}
                style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <Badge>{line.kind === "revenue" ? "Revenue" : "Cost"}</Badge>
                  <span
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {line.label}
                  </span>
                </span>
                <span style={{ fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
                  {formatMoney(line.amount, line.currency ?? currency)}
                </span>
              </div>
            ))
          )}
          <span className="muted" style={{ fontSize: 12 }}>
            Their own settlement figure and the rule behind it are always shown to them. The event's
            totals never are.
          </span>
        </div>
      )}
    </Card>
  );
}
