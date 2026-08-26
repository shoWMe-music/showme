import { Avatar, type AvatarTone, Card, Icon } from "@showme/design-system";
import { VenueSpecsCard } from "./VenueSpecsCard";

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
  amenities: string[];
  dealTypes: string[];
  capacitySetups: {
    id: string;
    name: string;
    capacitySitting: number | null;
    capacityStanding: number | null;
    isMain: boolean;
    notes: string | null;
  }[];
  cateringNotes: string | null;
  accommodationNotes: string | null;
  audienceLogisticsNotes: string | null;
}

export interface PublicPreviewProfile {
  id: string;
  slug: string;
  name: string;
  type: string | null;
  kind: string;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  genres: string[];
  setups: PublicPreviewSetup[];
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
  comingEvents: PublicPreviewEvent[];
  /** Whether the page is actually reachable. False → the banner says so. */
  isPublic: boolean;
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

function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

/** YouTube/Vimeo become an inline player; anything else stays an honest link. */
function videoEmbedUrl(url: string): string | null {
  const youtube = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/,
  );
  if (youtube?.[1]) return `https://www.youtube.com/embed/${youtube[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo?.[1]) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

export function ProfilePublicPreview({
  profile,
  comingEvents,
  isPublic,
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
              : "linear-gradient(120deg, var(--brand-red-glow), var(--brand-red-glow) 40%, var(--elevated))",
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
                    background: "var(--elevated)",
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
                    background: "var(--elevated)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <span
                    style={{
                      color: "var(--muted)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      minWidth: 52,
                    }}
                  >
                    {event.eventDate ? formatEventDate(event.eventDate) : "—"}
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

      {/* Bio + Location */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 16,
        }}
      >
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
      </div>

      {/* Performer line-ups. An operator sizes the stage, the rider and the
          travel party from this before they make an offer. */}
      {profile.setups.length > 0 && (
        <Card>
          <CardHeading icon={<Icon name="users" />} title="Setup Variations" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {profile.setups.map((setup) => (
              <div
                key={setup.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: "var(--elevated)",
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

      {/* Venue specs. `venueDetails` arrives already stripped: the projection
          never selects artist logistics or the booking contact, so this card
          cannot render them even by accident. */}
      {profile.venueDetails && <VenueSpecsCard venue={profile.venueDetails} />}

      {profile.venueDetails && profile.venueDetails.capacitySetups.length > 0 && (
        <Card>
          <CardHeading icon={<Icon name="users" />} title="Capacity Setups" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {profile.venueDetails.capacitySetups.map((setup) => (
              <div
                key={setup.id}
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: "var(--elevated)",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14, flex: 1 }}>
                    {setup.name}
                  </span>
                  {setup.isMain && (
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10.5,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "var(--brand-red)",
                      }}
                    >
                      Main
                    </span>
                  )}
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>
                    {[
                      setup.capacitySitting === null ? null : `${setup.capacitySitting} seated`,
                      setup.capacityStanding === null ? null : `${setup.capacityStanding} standing`,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                </div>
                {setup.notes && (
                  <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
                    {setup.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Photos */}
      <Card>
        <CardHeading icon={<ImageIcon />} title="Photos" />
        {profile.photos.length === 0 ? (
          <p style={{ color: "var(--dim)", fontSize: 14, margin: "10px 0 0" }}>No photos yet.</p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
              gap: 12,
              marginTop: 12,
            }}
          >
            {profile.photos.map((url) => (
              <img
                key={url}
                src={url}
                alt=""
                style={{
                  width: "100%",
                  aspectRatio: "16 / 9",
                  objectFit: "cover",
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                }}
              />
            ))}
          </div>
        )}
      </Card>

      {profile.videos.length > 0 && (
        <Card>
          <CardHeading icon={<VideoIcon />} title="Videos" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
              marginTop: 12,
            }}
          >
            {profile.videos.map((url) => {
              const embed = videoEmbedUrl(url);
              return embed ? (
                <iframe
                  key={url}
                  src={embed}
                  title={url}
                  allowFullScreen
                  style={{
                    width: "100%",
                    aspectRatio: "16 / 9",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                  }}
                />
              ) : (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--elevated)",
                    color: "var(--text)",
                    fontSize: 13.5,
                    textDecoration: "none",
                    overflow: "hidden",
                  }}
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
        background: "var(--elevated)",
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
        background: "var(--elevated)",
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
