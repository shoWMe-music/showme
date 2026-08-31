import { Badge, Card, Icon, KeyValueRow } from "@showme/design-system";
import { amenityLabel, dealTypeLabel } from "@showme/shared";

/** The venue facts a stranger may read, as the public projection returns them. */
export interface VenueSpecsCardProfile {
  capacity: number | null;
  soundSystem: string | null;
  curfew: string | null;
  audienceLogisticsNotes: string | null;
}

/**
 * The venue facts a stranger may NOT read — what the room throws in and the deal
 * shapes it signs (`docs/decisions.md` #19). They arrive on the preview response
 * as `withheldVenueDetails`, beside the public projection rather than inside it,
 * and this card draws them under their own heading so the owner can tell the two
 * apart at a glance.
 */
export interface VenueSpecsCardWithheld {
  amenities: string[];
  dealTypes: string[];
  cateringNotes: string | null;
  accommodationNotes: string | null;
}

export interface VenueSpecsCardProps {
  venue: VenueSpecsCardProfile;
  /** Absent for a viewer who is not owed the trade half; then nothing is drawn. */
  withheld?: VenueSpecsCardWithheld | null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 16 }}>
      <p
        style={{
          margin: "0 0 8px",
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        {title}
      </p>
      {children}
    </div>
  );
}

/**
 * The "Venue Specs" card from the prototype (`shoWMe All View.dc.html:3348`).
 *
 * It renders NOTHING for a field that is unset, rather than a row saying "—".
 * A venue that has not filled in its curfew has not told anyone its curfew, and
 * a blank row reads as "no curfew", which is a very different claim.
 *
 * The card is in two halves, and the split is the point. Above the rule is what
 * the open web gets: capacity, rig, curfew, and how the audience finds the door.
 * Below it is what the open web does NOT get — amenities, deal types, catering
 * and accommodation — drawn under an explicit heading rather than dropped.
 *
 * That heading is why the withheld half is drawn at all. This card lives only in
 * Preview, whose job is to answer "what does a stranger see", so silently
 * omitting four fields the owner spent time filling in would answer a different
 * question badly: the owner would conclude the data was lost. Showing them,
 * clearly marked, answers both questions at once.
 *
 * Note what is absent from BOTH halves: artist logistics and the booking contact.
 * The projection never selects them, so this card cannot draw them by accident.
 */
export function VenueSpecsCard({ venue, withheld }: VenueSpecsCardProps) {
  const hasPublicSpecs =
    venue.capacity !== null ||
    venue.soundSystem !== null ||
    venue.curfew !== null ||
    venue.audienceLogisticsNotes !== null;

  const hasWithheldSpecs =
    withheld !== undefined &&
    withheld !== null &&
    (withheld.amenities.length > 0 ||
      withheld.dealTypes.length > 0 ||
      withheld.cateringNotes !== null ||
      withheld.accommodationNotes !== null);

  if (!hasPublicSpecs && !hasWithheldSpecs) return null;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ color: "var(--brand-red)", display: "flex" }}>
          <Icon name="building" size={17} />
        </span>
        <h3
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 17,
            fontWeight: 600,
            color: "var(--text)",
            margin: 0,
          }}
        >
          Venue Specs
        </h3>
      </div>

      <div style={{ marginTop: 12 }}>
        {venue.capacity !== null && <KeyValueRow label="Capacity" value={String(venue.capacity)} />}
        {venue.soundSystem !== null && (
          <KeyValueRow label="Sound system" value={venue.soundSystem} />
        )}
        {venue.curfew !== null && <KeyValueRow label="Curfew" value={venue.curfew} />}
      </div>

      {venue.audienceLogisticsNotes && (
        <Section title="Getting here">
          <p style={{ margin: 0, fontSize: 14, color: "var(--text)" }}>
            {venue.audienceLogisticsNotes}
          </p>
        </Section>
      )}

      {hasWithheldSpecs && withheld && (
        <div
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: "1px dashed var(--border)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ color: "var(--muted)", display: "flex" }}>
              <Icon name="eye-off" size={14} />
            </span>
            <p
              style={{
                margin: 0,
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--muted)",
              }}
            >
              Not on your public page
            </p>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
            What the room offers and the deals you sign stay off the open web. You can share them
            when you are talking to someone.
          </p>

          {withheld.amenities.length > 0 && (
            <Section title="Amenities">
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {withheld.amenities.map((amenity) => (
                  <Badge key={amenity}>{amenityLabel(amenity)}</Badge>
                ))}
              </div>
            </Section>
          )}

          {withheld.dealTypes.length > 0 && (
            <Section title="Deals we sign">
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {withheld.dealTypes.map((dealType) => (
                  <Badge key={dealType}>{dealTypeLabel(dealType)}</Badge>
                ))}
              </div>
            </Section>
          )}

          {withheld.cateringNotes && (
            <Section title="Catering">
              <p style={{ margin: 0, fontSize: 14, color: "var(--text)" }}>
                {withheld.cateringNotes}
              </p>
            </Section>
          )}

          {withheld.accommodationNotes && (
            <Section title="Accommodation">
              <p style={{ margin: 0, fontSize: 14, color: "var(--text)" }}>
                {withheld.accommodationNotes}
              </p>
            </Section>
          )}
        </div>
      )}
    </Card>
  );
}
