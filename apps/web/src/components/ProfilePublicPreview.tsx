import { Avatar, type AvatarTone, Card, Icon } from "@showme/design-system";
import { parseVideoLink } from "@showme/shared";
import { formatDay } from "../lib/format";
import styles from "./ProfilePublicPreview.module.css";
import { VenueSpecsCard } from "./VenueSpecsCard";
import { VideoEmbed } from "./VideoEmbed";
import { WithheldNotice } from "./WithheldNotice";

/**
 * PREVIEW — the profile as a stranger sees it.
 *
 * Every value on this screen comes from `GET /profiles/:id/public-preview`, which
 * runs the SAME `serializePublicProfile` the anonymous `GET /public/profiles/:slug`
 * runs. Nothing here is filtered in the browser, and nothing here is read off the
 * member payload — that is the whole point.
 *
 * The screen it replaces did the opposite: it rendered the member projection under
 * a heading that said "Public view", so it showed draft events, and would have
 * shown the booking contact and artist logistics the moment someone added those
 * cards. A preview that is computed from privileged data is not a preview; it is a
 * second opinion about what is public, and it is always the wrong one.
 *
 * Presentational: it fetches nothing and decides nothing. Given the public payload
 * it draws it, and given a field the payload does not carry it draws nothing —
 * because a field a stranger does not receive is a field they do not see.
 */

export interface PublicPreviewSetup {
  name: string;
  headcount: number | null;
}

export interface PublicPreviewSocialLink {
  platform: string;
  url: string;
}

export interface PublicPreviewLocation {
  street: string | null;
  postcode: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
}

export interface PublicPreviewVenueDetails {
  capacity: number | null;
  soundSystem: string | null;
  curfew: string | null;
  audienceLogisticsNotes: string | null;
}

/**
 * The trade half the anonymous page no longer receives (`docs/decisions.md` #19)
 * — the venue's, and the performer's line-ups, which size a booking the same way.
 * It rides on the preview response as a SIBLING of `profile`, never inside it, so
 * `profile` stays exactly the anonymous body — see `PublicPreviewResponse`.
 */
export interface PublicPreviewWithheldDetails {
  setups: PublicPreviewSetup[];
  venue: {
    amenities: string[];
    dealTypes: string[];
    cateringNotes: string | null;
    accommodationNotes: string | null;
  } | null;
}

export interface PublicPreviewProfile {
  id: string;
  slug: string;
  name: string;
  type: string | null;
  kind: string;
  bio: string | null;
  /** The line under the name on the public page. Null until the owner writes one. */
  tagline: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  genres: string[];
  socialLinks: PublicPreviewSocialLink[];
  photos: string[];
  videos: string[];
  location: PublicPreviewLocation | null;
  venueDetails: PublicPreviewVenueDetails | null;
}

export interface PublicPreviewEvent {
  id: string;
  title: string;
  eventDate: string | null;
  venueName: string | null;
  doorTime: string | null;
  startTime: string | null;
}

export interface ProfilePublicPreviewProps {
  profile: PublicPreviewProfile;
  /**
   * The bill. Now read off `profile.upcomingShows` — the SAME field the anonymous
   * page serves — rather than a sibling `comingEvents` built by a second query.
   * That query filtered on `events.venue_profile_id`, so a performer previewed an
   * empty bill however many shows they were confirmed on.
   */
  comingEvents: PublicPreviewEvent[];
  /** Whether the page is actually reachable. False → the banner says so. */
  isPublic: boolean;
  /**
   * What a stranger does not get. Drawn under its own "not on your public page"
   * heading — in Venue Specs for the room's trade half, in its own card for the
   * line-ups — so the owner sees what they entered without being told the open
   * web sees it too.
   */
  withheldDetails: PublicPreviewWithheldDetails;
  /** Avatar colour, so the chip strip and the preview agree. */
  tone: AvatarTone;
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * The address exactly as the public projection hands it over.
 *
 * `street` and `postcode` arrive as null for anything that is not a place — the
 * SERVER decided that (see `serialize/profile.ts`), so this function does not
 * need to know whether it is drawing a venue or a band. It joins what it was
 * given: "Hornsgatan 12, 118 20 Stockholm, SE" for the venue, "Stockholm, SE" for
 * the band.
 */
function formatPublicAddress(location: PublicPreviewLocation | null): string | null {
  if (!location) return null;
  const postcodeAndCity = [location.postcode, location.city].filter(Boolean).join(" ");
  const parts = [location.street, postcodeAndCity, location.country].filter(
    (part): part is string => typeof part === "string" && part.trim() !== "",
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

export function ProfilePublicPreview({
  profile,
  comingEvents,
  isPublic,
  withheldDetails,
  tone,
}: ProfilePublicPreviewProps) {
  const address = formatPublicAddress(profile.location);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PreviewBanner isPublic={isPublic} slug={profile.slug} />

      {/* Hero: cover banner + overlapping avatar + identity */}
      <Card padding="none" style={{ overflow: "hidden" }}>
        <div
          style={{
            height: 190,
            background: profile.bannerUrl
              ? `center / cover no-repeat url(${profile.bannerUrl})`
              : "linear-gradient(120deg, var(--brand-red-glow), var(--brand-red-glow) 40%, var(--surface))",
          }}
        />
        <div style={{ padding: "0 28px 28px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 20,
              marginTop: -56,
              marginBottom: 14,
            }}
          >
            <Avatar
              initials={initialsOf(profile.name)}
              src={profile.avatarUrl ?? undefined}
              shape="circle"
              size={112}
              tone={tone}
              style={{ border: "5px solid var(--card)", flexShrink: 0 }}
            />
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 32,
                fontWeight: 700,
                color: "var(--text)",
                margin: 0,
                paddingBottom: 10,
              }}
            >
              {profile.name}
            </h2>
          </div>

          {/* The line under the name — the first thing the public page sets, so
              the preview has to show whether it is set at all. An unwritten one
              says so rather than leaving a gap the owner cannot interpret. */}
          <p
            style={{
              margin: "6px 0 0",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 17,
              color: profile.tagline ? "var(--accent)" : "var(--dim)",
            }}
          >
            {profile.tagline ?? "No tagline yet."}
          </p>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {profile.genres.length > 0 ? (
              profile.genres.map((genre) => <Pill key={genre}>{genre}</Pill>)
            ) : (
              <span style={{ color: "var(--dim)", fontSize: 13 }}>No genres yet</span>
            )}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              marginTop: 14,
              color: address ? "var(--muted)" : "var(--dim)",
              fontSize: 14,
            }}
          >
            <MapPinIcon />
            {address ?? "No location set"}
          </div>

          {profile.socialLinks.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              {profile.socialLinks.map((link) => (
                <a
                  key={`${link.platform}-${link.url}`}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "5px 13px",
                    borderRadius: 999,
                    border: "1px solid var(--border)",
                    background: "var(--shape-fill)",
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--text)",
                    textDecoration: "none",
                  }}
                >
                  <Icon name="link" size={13} />
                  {link.platform}
                </a>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Coming Events — only the shows the world was actually told about. The
          server applied that rule (published + confirmed/concluded); this list
          simply prints what came back, which is why a draft cannot appear. */}
      <Card>
        <CardHeading icon={<Icon name="calendar" />} title="Coming Events" />
        {comingEvents.length === 0 ? (
          <p style={{ color: "var(--dim)", fontSize: 14, margin: "8px 0 0" }}>
            No upcoming events scheduled.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {comingEvents.map((event) => {
              const times = [
                event.doorTime ? `Doors ${event.doorTime}` : null,
                event.startTime ? `Show ${event.startTime}` : null,
              ].filter(Boolean);
              return (
                <div
                  key={event.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "12px 14px",
                    borderRadius: 12,
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <span
                    style={{
                      color: "var(--muted)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      minWidth: 96,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatDay(event.eventDate)}
                  </span>
                  <span style={{ fontWeight: 600, color: "var(--text)", flex: 1 }}>
                    {event.title}
                  </span>
                  {times.length > 0 && (
                    <span style={{ color: "var(--muted)", fontSize: 13 }}>{times.join(" · ")}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Bio, then Location UNDER it. They used to sit side by side, two-thirds
          and one-third, which gave a paragraph of prose a narrow column and a
          one-line address a whole card of empty space beside it. Stacked, each
          gets the width it actually needs and the phone layout is the same
          layout rather than a collapsed one. */}
      <Card>
        <CardHeading title="Bio" />
        <p
          style={{
            margin: "10px 0 0",
            lineHeight: 1.6,
            fontSize: 14.5,
            color: profile.bio ? "var(--text)" : "var(--dim)",
          }}
        >
          {profile.bio ?? "No bio yet."}
        </p>
      </Card>

      <Card>
        <CardHeading icon={<MapPinIcon />} title="Location" />
        <p
          style={{
            margin: "10px 0 0",
            fontSize: 14.5,
            color: address ? "var(--text)" : "var(--dim)",
          }}
        >
          {address ?? "No location set"}
        </p>
      </Card>

      {/* Performer line-ups — an operator sizes the stage, the rider and the travel
          party from this before they make an offer, which is exactly why the open
          web does not get them (`docs/decisions.md` #19). They arrive on the
          withheld sibling, never inside `profile`, so this card cannot draw a
          field the anonymous page also has. */}
      {withheldDetails.setups.length > 0 && (
        <Card>
          <CardHeading icon={<Icon name="users" />} title="Setup Variations" />
          <WithheldNotice>
            Who comes with you sizes an offer, so it stays for the people you are talking to rather
            than the open web.
          </WithheldNotice>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {withheldDetails.setups.map((setup) => (
              <div
                key={setup.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>
                  {setup.name}
                </span>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>
                  {setup.headcount === null ? "—" : `${setup.headcount} people`}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Venue specs, in two halves. `venueDetails` arrives already stripped: the
          projection never selects artist logistics, the booking contact or the
          trade details, so this card cannot render them as public even by
          accident. The trade half comes in separately and is drawn as withheld. */}
      {profile.venueDetails && (
        <VenueSpecsCard venue={profile.venueDetails} withheld={withheldDetails.venue} />
      )}

      {/* NO capacity-setups card. It used to render one, and it was the one thing
          in this preview a stranger could NOT actually see: the public page
          (`apps/marketing/src/profile.ts`) reads a whitelist that never included
          setups, so Preview was showing more than the page it claims to be. The
          setups are a room's own alternate arrangements now (migration 0029) and
          live on the venue's rooms card; the capacity a stranger reads is the
          chip in Venue Specs above. */}

      {/* Photos. Absent when there are none, because that is what the public page
          does — a "No photos yet" card on a stranger's page tells them nothing
          true about the profile, and a preview that shows one is not a preview
          (the owner sees the empty state in Edit, where it is actionable). */}
      {profile.photos.length > 0 && (
        <Card>
          <CardHeading icon={<ImageIcon />} title="Photos" />
          {/* Every photo keeps its own shape — see `.gallery` in the stylesheet
              beside this file for what it used to do instead. */}
          <div className={styles.gallery}>
            {profile.photos.map((url) => (
              <img key={url} className={styles.galleryItem} src={url} alt="" loading="lazy" />
            ))}
          </div>
        </Card>
      )}

      {profile.videos.length > 0 && (
        <Card>
          <CardHeading icon={<VideoIcon />} title="Videos" />
          {/* Three to a row, the first bigger only when there are three, and a
              link out of each — see the stylesheet beside this file. */}
          <div className={styles.videos}>
            {profile.videos.map((url, index) => {
              // Parsed, never interpolated: `VideoEmbed` is handed a link whose
              // `embedUrl` was BUILT from a provider and an id. A stored value
              // this cannot parse predates the rule and stays an honest link.
              const link = parseVideoLink(url);
              const featured = index === 0 && profile.videos.length >= 3;
              return link ? (
                <div
                  key={url}
                  className={
                    featured ? `${styles.videoTile} ${styles.videoTileFeatured}` : styles.videoTile
                  }
                >
                  <VideoEmbed link={link} title={`Video ${index + 1}`} />
                  <a
                    className={styles.videoOut}
                    href={link.canonicalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Icon name="link" size={11} />
                    {link.provider === "youtube" ? "YouTube" : "Vimeo"}
                  </a>
                </div>
              ) : (
                <a
                  key={url}
                  className={styles.videoUnparsed}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="link" size={14} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{url}</span>
                </a>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * The one honest sentence the old switcher never said.
 *
 * "Preview" without this reads as "here is your live page", which for an
 * unpublished profile is false — and being false about reachability is how an
 * owner ends up believing they published something they did not.
 */
function PreviewBanner({ isPublic, slug }: { isPublic: boolean; slug: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 16px",
        borderRadius: 12,
        border: `1px solid ${isPublic ? "var(--border)" : "var(--brand-red)"}`,
        background: "var(--card)",
        color: "var(--muted)",
        fontSize: 13.5,
      }}
    >
      <span style={{ color: isPublic ? "var(--muted)" : "var(--brand-red)", display: "flex" }}>
        <Icon name={isPublic ? "eye" : "eye-off"} size={15} />
      </span>
      {isPublic ? (
        <span>
          This is exactly what anyone visiting{" "}
          <strong style={{ color: "var(--text)" }}>/{slug}</strong> sees. Nothing private is on this
          page.
        </span>
      ) : (
        <span>
          Preview only — this profile is{" "}
          <strong style={{ color: "var(--text)" }}>not published</strong>, so nobody can reach it
          yet. Turn on “Publish this profile publicly” in Edit.
        </span>
      )}
    </div>
  );
}

function CardHeading({ icon, title }: { icon?: React.ReactNode; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      {icon ? <span style={{ color: "var(--brand-red)", display: "flex" }}>{icon}</span> : null}
      <h3
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 17,
          fontWeight: 600,
          color: "var(--text)",
          margin: 0,
        }}
      >
        {title}
      </h3>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        padding: "5px 13px",
        borderRadius: 999,
        border: "1px solid var(--border)",
        background: "var(--shape-fill)",
        fontSize: 13,
        fontWeight: 500,
        color: "var(--text)",
      }}
    >
      {children}
    </span>
  );
}

function MapPinIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Location"
    >
      <title>Location</title>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Videos"
    >
      <title>Videos</title>
      <rect x="2" y="5" width="14" height="14" rx="2" />
      <path d="m22 8-6 4 6 4V8Z" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Photos"
    >
      <title>Photos</title>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}
