import { Badge, type Status } from "@showme/design-system";

/**
 * Who can see a field once it is saved. Three tiers, decided 2026-08-31, and the
 * middle one is new — amenities, deal types, catering and accommodation notes
 * used to go out to the open web and now stop at the sign-in wall.
 *
 * This is the vocabulary the EDITOR speaks. The enforcement lives in
 * `apps/api/src/serialize/profile.ts`; what this file guarantees is that a venue
 * owner is never surprised by it.
 */
export type FieldAudience = "public" | "industry" | "private";

interface AudienceCopy {
  /** The pill: who, in three or four words. */
  badge: string;
  status: Status;
  /** The heading: the same fact as a sentence fragment. */
  title: string;
  /** One line saying exactly what "published" means for this tier. */
  explanation: string;
}

export const AUDIENCE_COPY: Record<FieldAudience, AudienceCopy> = {
  public: {
    badge: "Anyone on the web",
    status: "task",
    title: "On your public page",
    explanation:
      "Published. Search engines and anyone with the link can read this, with no account and no sign-in.",
  },
  industry: {
    badge: "Off your public page",
    status: "pending",
    title: "Kept back for booking conversations",
    // Deliberately says what is TRUE TODAY, not what is planned. There is no
    // screen anywhere in the product where one account can browse another's
    // profile (every `/profiles/:id` read is member-gated), so "shown to
    // signed-in promoters" would be a promise the product does not keep — and a
    // form that overstates who sees a field is the exact defect this whole
    // section exists to fix. Widen this sentence in the same change that ships
    // the industry-facing profile view, not before.
    explanation:
      "Taken off your public page. An anonymous visitor never sees it — today only you and your team can, and it is what we would show a promoter who asks.",
  },
  private: {
    badge: "Never published",
    status: "cancelled",
    title: "Yours, and the parties you book",
    explanation:
      "Kept off your public page entirely. Only you and the people booked on an event with you can read it.",
  },
};

/** Top to bottom: most exposed first, so the reader meets the open web before the safe. */
export const AUDIENCE_ORDER: FieldAudience[] = ["public", "industry", "private"];

export interface AudienceSectionProps {
  audience: FieldAudience;
  children: React.ReactNode;
}

/**
 * A group of fields under a heading that names its audience.
 *
 * The point is that the audience is the ONLY thing a group is allowed to be
 * about. The venue form used to be grouped by topic — "The house", "What you
 * provide", "Deals you'll sign" — with a hand-typed "— private" suffix on the
 * two groups whose author happened to remember. A venue owner read the labelled
 * ones as the exception and everything else as internal; all six unlabelled
 * fields were published. That is the partner complaint, and a topic heading can
 * never fix it, because a topic says nothing about who is reading.
 */
export function AudienceSection({ audience, children }: AudienceSectionProps) {
  const copy = AUDIENCE_COPY[audience];
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h4
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text)",
              margin: 0,
            }}
          >
            {copy.title}
          </h4>
          <Badge status={copy.status} dot>
            {copy.badge}
          </Badge>
        </div>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--dim)" }}>
          {copy.explanation}
        </p>
      </header>
      {children}
    </section>
  );
}
