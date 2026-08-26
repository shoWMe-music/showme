import { Badge, Card, Icon, KeyValueRow } from "@showme/design-system";
import { amenityLabel, dealTypeLabel } from "@showme/shared";

/** The venue facts a viewer may read, as the profile route returns them. */
export interface VenueSpecsCardProfile {
  capacity: number | null;
  soundSystem: string | null;
  curfew: string | null;
  amenities: string[];
  dealTypes: string[];
  cateringNotes: string | null;
  accommodationNotes: string | null;
  audienceLogisticsNotes: string | null;
}

export interface VenueSpecsCardProps {
  venue: VenueSpecsCardProfile;
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
 * The "Venue Specs" card from the prototype (`shoWMe All View.dc.html:3348`),
 * with the amenities the prototype only ever put on an event.
 *
 * It renders NOTHING for a field that is unset, rather than a row saying "—".
 * A venue that has not filled in its curfew has not told anyone its curfew, and
 * a blank row reads as "no curfew", which is a very different claim.
 *
 * Note what is absent: artist logistics and the booking contact. This card is
 * shown on the profile's public-facing view, and `decisions.md` #16.7 puts artist
 * logistics on the private side of the line. They are edited elsewhere and shown
 * to booked parties, never here.
 */
export function VenueSpecsCard({ venue }: VenueSpecsCardProps) {
  const hasSpecs =
    venue.capacity !== null ||
    venue.soundSystem !== null ||
    venue.curfew !== null ||
    venue.amenities.length > 0 ||
    venue.dealTypes.length > 0 ||
    venue.cateringNotes !== null ||
    venue.accommodationNotes !== null ||
    venue.audienceLogisticsNotes !== null;

  if (!hasSpecs) return null;

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

      {venue.amenities.length > 0 && (
        <Section title="Amenities">
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {venue.amenities.map((amenity) => (
              <Badge key={amenity}>{amenityLabel(amenity)}</Badge>
            ))}
          </div>
        </Section>
      )}

      {venue.dealTypes.length > 0 && (
        <Section title="Deals we sign">
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {venue.dealTypes.map((dealType) => (
              <Badge key={dealType}>{dealTypeLabel(dealType)}</Badge>
            ))}
          </div>
        </Section>
      )}

      {venue.cateringNotes && (
        <Section title="Catering">
          <p style={{ margin: 0, fontSize: 14, color: "var(--text)" }}>{venue.cateringNotes}</p>
        </Section>
      )}

      {venue.accommodationNotes && (
        <Section title="Accommodation">
          <p style={{ margin: 0, fontSize: 14, color: "var(--text)" }}>
            {venue.accommodationNotes}
          </p>
        </Section>
      )}

      {venue.audienceLogisticsNotes && (
        <Section title="Getting here">
          <p style={{ margin: 0, fontSize: 14, color: "var(--text)" }}>
            {venue.audienceLogisticsNotes}
          </p>
        </Section>
      )}
    </Card>
  );
}
