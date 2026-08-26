import {
  type getApiV1Profiles,
  type getApiV1ProfilesId,
  useGetApiV1Profiles,
  useGetApiV1ProfilesId,
  usePatchApiV1ProfilesId,
  usePostApiV1Profiles,
} from "@showme/api-client";
import {
  Avatar,
  type AvatarTone,
  Button,
  Card,
  EmptyState,
  Icon,
  Modal,
  SectionHeader,
  Select,
  TextField,
  Toggle,
  useToast,
} from "@showme/design-system";
import { COUNTRY_CODES, isPlaceProfile, profileTypesForKind } from "@showme/shared";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { SegmentedToggle } from "../components";
import {
  EMPTY_VENUE_DETAILS,
  type VenueDetailsDraft,
  VenueDetailsFields,
} from "../components/VenueDetailsFields";
import { VenueNotesField } from "../components/VenueNotesField";
import { VenueSpecsCard } from "../components/VenueSpecsCard";
import { ErrorState, LoadingState } from "../components/states";
import { useAllEvents } from "../hooks/useEventList";
import { getActiveProfileId, setActiveProfileId } from "../lib/activeProfile";
import { errorMessage } from "../lib/errors";
import { apiStatusToDisplay } from "../lib/status";

type Profile = Awaited<ReturnType<typeof getApiV1Profiles>>[number];
type ProfileDetail = Awaited<ReturnType<typeof getApiV1ProfilesId>>;
type ViewMode = "public" | "private";

const CHIP_TONES: AvatarTone[] = ["brand", "green", "blue", "purple", "amber"];

function capitalize(value: string): string {
  return value.replace(/^\w/, (character) => character.toUpperCase());
}

/** Chip subtitle / role label — the granular type wins, else the account kind. */
function typeLabel(profile: Pick<Profile, "kind" | "type">): string {
  return capitalize(profile.type ?? profile.kind);
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `details` is untyped jsonb (social/media/custom). Read the fields we know
 * about defensively — anything absent renders an empty state.
 *
 * `location` is deliberately NOT read here any more. It used to be, and that was
 * the bug: the editor wrote a string into this blob while the seed (and every
 * query in the API) used the `profile_locations` table, so a venue with a
 * location rendered "No location set". The profile route now returns
 * `profile.location` from that table, and migration 0010 moved any stray strings
 * into it. */
function readDetails(details: unknown): { genres: string[] } {
  if (details && typeof details === "object") {
    const record = details as Record<string, unknown>;
    const genres = Array.isArray(record.genres)
      ? record.genres.filter((genre): genre is string => typeof genre === "string")
      : [];
    return { genres };
  }
  return { genres: [] };
}

/** "Stockholm, SE" — whichever halves the profile actually has, or null. */
function formatLocation(
  location: { city: string | null; country: string | null } | null | undefined,
): string | null {
  if (!location) return null;
  const parts = [location.city, location.country].filter(
    (part): part is string => typeof part === "string" && part.trim() !== "",
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

export function Profiles() {
  const profiles = useGetApiV1Profiles();
  // Every event — the panel lists a profile's upcoming shows, and the ones on
  // page one are not "the upcoming shows".
  const events = useAllEvents();
  const [creating, setCreating] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("public");
  const [selectedId, setSelectedId] = useState<string | null>(getActiveProfileId());

  const list = profiles.data ?? [];

  // Default the selection to the acting profile, or the first one we have.
  useEffect(() => {
    const first = list[0];
    if (selectedId || !first) return;
    setSelectedId(first.id);
    setActiveProfileId(first.id);
  }, [selectedId, list]);

  const detail = useGetApiV1ProfilesId(selectedId ?? "", {
    query: { enabled: Boolean(selectedId) },
  });

  const selectProfile = (profileId: string) => {
    setActiveProfileId(profileId);
    setSelectedId(profileId);
    // Events are scoped by the acting-profile header — re-pull for the new one.
    events.refetch();
  };

  const comingEvents = useMemo(() => {
    if (!selectedId) return [];
    const now = Date.now();
    return events.items
      .filter(
        (event) =>
          event.venueProfileId === selectedId &&
          event.status !== "cancelled" &&
          event.eventDate !== null &&
          Date.parse(event.eventDate) >= now,
      )
      .sort((left, right) => Date.parse(left.eventDate ?? "") - Date.parse(right.eventDate ?? ""));
  }, [events.items, selectedId]);

  const selectedIndex = Math.max(
    0,
    list.findIndex((profile) => profile.id === selectedId),
  );

  return (
    <>
      <SectionHeader
        title="My Profiles"
        subtitle="Manage your public-facing profiles for each role"
        actions={
          <SegmentedToggle<ViewMode>
            aria-label="Profile view mode"
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: "public", label: "Public view" },
              { value: "private", label: "Private (edit)" },
            ]}
          />
        }
      />

      {profiles.isPending ? (
        <LoadingState label="Loading profiles" />
      ) : profiles.isError ? (
        <ErrorState error={profiles.error} title="Couldn't load your profiles" />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Icon name="building" />}
          title="Create your first profile"
          description="Each venue or brand you run is a profile with its own public page."
          action={
            <Button
              variant="primary"
              leftIcon={<Icon name="plus" />}
              onClick={() => setCreating(true)}
            >
              New profile
            </Button>
          }
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Horizontal profile-chip selector */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "stretch" }}>
            {list.map((profile, index) => {
              const active = profile.id === selectedId;
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => selectProfile(profile.id)}
                  aria-pressed={active}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    borderRadius: 16,
                    minWidth: 180,
                    // Selection reads as an OUTLINE, not a fill — and a QUIET one.
                    // Same 1px hairline every other card in the app uses, just
                    // recoloured to the brand; no ring, no halo, no extra weight.
                    // The strip sits above a page of 1px-bordered cards, so a
                    // heavier treatment here reads as a different design language
                    // rather than as "this one is selected".
                    background: "var(--card)",
                    border: `1px solid ${active ? "var(--brand-red)" : "var(--border)"}`,
                    // No padding compensation needed: the border width never changes,
                    // so nothing shifts when selection moves.
                    padding: "12px 16px",
                    transition:
                      "border-color .15s var(--ease-out), box-shadow .15s var(--ease-out)",
                  }}
                >
                  <Avatar
                    initials={initialsOf(profile.name)}
                    shape="circle"
                    size={38}
                    tone={CHIP_TONES[index % CHIP_TONES.length]}
                  />
                  <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
                    <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>
                      {profile.name}
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
                      {typeLabel(profile)}
                    </span>
                  </span>
                </button>
              );
            })}

            {/* Add-profile chip */}
            <button
              type="button"
              onClick={() => setCreating(true)}
              aria-label="New profile"
              style={{
                all: "unset",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 56,
                borderRadius: 16,
                color: "var(--muted)",
                border: "1.5px dashed var(--border-strong)",
              }}
            >
              <Icon name="plus" />
            </button>
          </div>

          {/* Selected profile */}
          {detail.isPending ? (
            <LoadingState label="Loading profile" />
          ) : detail.isError ? (
            <ErrorState error={detail.error} title="Couldn't load this profile" />
          ) : detail.data ? (
            viewMode === "public" ? (
              <PublicProfile
                profile={detail.data}
                toneIndex={selectedIndex}
                comingEvents={comingEvents}
                eventsPending={events.isPending}
              />
            ) : (
              <ProfileEditor profile={detail.data} onSaved={() => void detail.refetch()} />
            )
          ) : null}
        </div>
      )}

      <NewProfileModal
        open={creating}
        // Every profile inherits the account's kind, so any one of them is an
        // exact source for it. (`GET /me` does not return `kind` today.)
        accountKind={list[0]?.kind ?? null}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false);
          void profiles.refetch().then(() => created && selectProfile(created));
        }}
      />
    </>
  );
}

type ComingEvent = {
  id: string;
  title: string;
  status: string;
  eventDate: string | null;
};

function PublicProfile({
  profile,
  toneIndex,
  comingEvents,
  eventsPending,
}: {
  profile: ProfileDetail;
  toneIndex: number;
  comingEvents: ComingEvent[];
  eventsPending: boolean;
}) {
  const { genres } = readDetails(profile.details);
  // From `profile_locations` via the API, not from the `details` blob — see
  // readDetails. `undefined` would mean "this route doesn't carry it"; this one
  // always does.
  const location = formatLocation(profile.location);
  const tone = CHIP_TONES[toneIndex % CHIP_TONES.length];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
          {/* Avatar overlaps the banner; the name sits inline to its right,
              bottom-aligned on the surface band (matches the design). */}
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

          {/* Genre pills */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {genres.length > 0 ? (
              genres.map((genre) => <Pill key={genre}>{genre}</Pill>)
            ) : (
              <span style={{ color: "var(--muted)", fontSize: 13 }}>No genres yet</span>
            )}
          </div>

          {/* Location line */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              marginTop: 14,
              color: location ? "var(--muted)" : "var(--dim)",
              fontSize: 14,
            }}
          >
            <MapPinIcon />
            {location ?? "No location set"}
          </div>
        </div>
      </Card>

      {/* Coming Events */}
      <Card>
        <CardHeading icon={<Icon name="calendar" />} title="Coming Events" />
        {eventsPending ? (
          <p style={{ color: "var(--muted)", fontSize: 14, margin: "8px 0 0" }}>Loading events…</p>
        ) : comingEvents.length === 0 ? (
          <p style={{ color: "var(--dim)", fontSize: 14, margin: "8px 0 0" }}>
            No upcoming events scheduled.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {comingEvents.map((event) => (
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
                <span style={{ color: "var(--muted)", fontSize: 13 }}>
                  {apiStatusToDisplay(event.status).label}
                </span>
              </div>
            ))}
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
              color: location ? "var(--text)" : "var(--dim)",
            }}
          >
            {location ?? "No location set"}
          </p>
        </Card>
      </div>

      {/* What the room actually offers. Absent for a profile with nothing
          recorded, and for every non-venue profile — a booking agency has no
          curfew. Artist logistics and the booking contact are NOT in this card;
          they are private (decisions.md #16.7). */}
      {profile.venueDetails && <VenueSpecsCard venue={profile.venueDetails} />}

      {/* Photos */}
      <Card>
        <CardHeading icon={<ImageIcon />} title="Photos" />
        <p style={{ color: "var(--dim)", fontSize: 14, margin: "10px 0 0" }}>No photos yet.</p>
      </Card>
    </div>
  );
}

/** API shape → form draft. Every field becomes a string the input can hold; a
 * missing `venueDetails` (this profile has none recorded) becomes empty fields
 * rather than a disabled form. */
function toVenueDraft(venueDetails: ProfileDetail["venueDetails"]): VenueDetailsDraft {
  if (!venueDetails) return EMPTY_VENUE_DETAILS;
  return {
    capacity: venueDetails.capacity === null ? "" : String(venueDetails.capacity),
    soundSystem: venueDetails.soundSystem ?? "",
    curfew: venueDetails.curfew ?? "",
    amenities: venueDetails.amenities ?? [],
    dealTypes: venueDetails.dealTypes ?? [],
    cateringNotes: venueDetails.cateringNotes ?? "",
    accommodationNotes: venueDetails.accommodationNotes ?? "",
    artistLogisticsNotes: venueDetails.artistLogisticsNotes ?? "",
    audienceLogisticsNotes: venueDetails.audienceLogisticsNotes ?? "",
    contactEmail: venueDetails.contactEmail ?? "",
    contactPhone: venueDetails.contactPhone ?? "",
  };
}

/** Form draft → API body. An emptied field is sent as `null`, not as `""`:
 * "" would be a value the venue never chose, and the read side distinguishes
 * "no curfew recorded" from "the curfew is the empty string". */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function fromVenueDraft(draft: VenueDetailsDraft) {
  const capacity = draft.capacity.trim();
  const parsedCapacity = capacity === "" ? null : Number.parseInt(capacity, 10);
  return {
    // A number input can still hold something unparseable; never send NaN.
    capacity: parsedCapacity !== null && Number.isFinite(parsedCapacity) ? parsedCapacity : null,
    soundSystem: blankToNull(draft.soundSystem),
    curfew: blankToNull(draft.curfew),
    amenities: draft.amenities,
    dealTypes: draft.dealTypes,
    cateringNotes: blankToNull(draft.cateringNotes),
    accommodationNotes: blankToNull(draft.accommodationNotes),
    artistLogisticsNotes: blankToNull(draft.artistLogisticsNotes),
    audienceLogisticsNotes: blankToNull(draft.audienceLogisticsNotes),
    contactEmail: blankToNull(draft.contactEmail),
    contactPhone: blankToNull(draft.contactPhone),
  };
}

function ProfileEditor({
  profile,
  onSaved,
}: {
  profile: ProfileDetail;
  onSaved: () => void;
}) {
  const toast = useToast();
  const initial = readDetails(profile.details);
  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [city, setCity] = useState(profile.location?.city ?? "");
  const [country, setCountry] = useState(profile.location?.country ?? "");
  const [genres, setGenres] = useState(initial.genres.join(", "));
  const [isPublic, setIsPublic] = useState(profile.isPublic);
  const [profileType, setProfileType] = useState(profile.type ?? "");
  const [venue, setVenue] = useState<VenueDetailsDraft>(() => toVenueDraft(profile.venueDetails));

  // Only a place has a capacity and a curfew — a promoter or a booking agency is
  // an organisation, not a room.
  const showsVenueFields = isPlaceProfile(profile.kind, profile.type);
  const typeOptions = profileTypesForKind(profile.kind);

  // Re-seed the form whenever a different profile is selected.
  useEffect(() => {
    const details = readDetails(profile.details);
    setName(profile.name);
    setBio(profile.bio ?? "");
    setCity(profile.location?.city ?? "");
    setCountry(profile.location?.country ?? "");
    setGenres(details.genres.join(", "));
    setIsPublic(profile.isPublic);
    setProfileType(profile.type ?? "");
    setVenue(toVenueDraft(profile.venueDetails));
  }, [profile]);

  const patch = usePatchApiV1ProfilesId({
    mutation: {
      onSuccess: () => {
        toast.success("Profile updated");
        onSaved();
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't save the profile.")),
    },
  });

  const save = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    const baseDetails =
      profile.details && typeof profile.details === "object"
        ? (profile.details as Record<string, unknown>)
        : {};
    const genreList = genres
      .split(",")
      .map((genre) => genre.trim())
      .filter((genre) => genre.length > 0);
    patch.mutate({
      id: profile.id,
      data: {
        name: name.trim(),
        bio: bio.trim() ? bio.trim() : null,
        isPublic,
        ...(profileType ? { type: profileType } : {}),
        // The location goes to `profile_locations` through its own field, NOT
        // into `details` — that split is the whole point of the fix.
        location: {
          city: city.trim() ? city.trim() : null,
          country: country.trim() ? country.trim() : null,
        },
        details: { ...baseDetails, genres: genreList },
        ...(showsVenueFields ? { venueDetails: fromVenueDraft(venue) } : {}),
      },
    });
  };

  return (
    <Card>
      <CardHeading icon={<Icon name="settings" />} title="Edit profile" />
      <form
        onSubmit={save}
        style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 14 }}
      >
        <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} />

        {typeOptions.length > 0 && (
          <Select
            label="Type"
            value={profileType}
            onChange={setProfileType}
            // Constrained to what this ACCOUNT KIND may be. The kind itself is
            // fixed at signup and inherited — it is not editable here at all.
            options={typeOptions.map((option) => ({ value: option.key, label: option.label }))}
            placeholder="Choose a type…"
          />
        )}

        <VenueNotesField
          label="Bio"
          value={bio}
          rows={4}
          placeholder="Tell people what this profile is about"
          onChange={setBio}
        />

        {/* City and country are two fields because they are two columns in
            `profile_locations`, and `country` is the ISO code that decides the
            event timezone and an agent's territory — it cannot be prose. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr",
            gap: 14,
          }}
        >
          <TextField
            label="City"
            value={city}
            placeholder="e.g. Stockholm"
            onChange={(event) => setCity(event.target.value)}
          />
          <Select
            label="Country"
            value={country}
            onChange={setCountry}
            options={[...COUNTRY_CODES]}
            placeholder="—"
          />
        </div>

        <TextField
          label="Genres (comma-separated)"
          value={genres}
          placeholder="e.g. Live, Club, Concert"
          onChange={(event) => setGenres(event.target.value)}
        />

        {showsVenueFields && (
          <>
            <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "4px 0" }} />
            <VenueDetailsFields value={venue} onChange={setVenue} />
            <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "4px 0" }} />
          </>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Toggle checked={isPublic} onChange={setIsPublic} label="Publish this profile publicly" />
          <span style={{ color: "var(--text)", fontSize: 14 }}>Publish this profile publicly</span>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            variant="primary"
            onClick={save}
            disabled={patch.isPending || name.trim().length === 0}
            leftIcon={<Icon name="check" />}
          >
            {patch.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
        <button type="submit" hidden aria-hidden />
      </form>
    </Card>
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

function NewProfileModal({
  open,
  onClose,
  onCreated,
  accountKind,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (createdId?: string) => void;
  /** The account's kind, read off a profile the user already owns (every
   * profile inherits it). Null only before the first profile exists, in which
   * case the type picker is hidden — the server still infers the kind. */
  accountKind: string | null;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const typeOptions = accountKind ? profileTypesForKind(accountKind) : [];

  const create = usePostApiV1Profiles({
    mutation: {
      onSuccess: (created) => {
        toast.success(`"${name}" created`);
        onCreated(created?.id);
        setName("");
        setType("");
      },
      onError: (mutationError) =>
        toast.error(errorMessage(mutationError, "Couldn't create the profile.")),
    },
  });

  const canSubmit = name.trim().length > 0;

  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!canSubmit) return;
    create.mutate({
      data: {
        // `kind` is NOT sent. It is fixed per account and inherited from the
        // owner (CLAUDE.md, story.md); the API reads it from the user row.
        name: name.trim(),
        slug: slugify(name),
        ...(type ? { type } : {}),
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New profile"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!canSubmit || create.isPending}
            leftIcon={<Icon name="plus" />}
          >
            {create.isPending ? "Creating…" : "Create profile"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField
          label="Name"
          value={name}
          placeholder="e.g. The Nest"
          onChange={(changeEvent) => setName(changeEvent.target.value)}
          autoFocus
        />
        {typeOptions.length > 0 && (
          <Select
            label="Type"
            value={type}
            onChange={setType}
            // Only the types THIS account kind can create. An operator account
            // makes venues and promoters; it can never make a band, so the
            // option is not offered rather than offered and then rejected.
            options={typeOptions.map((option) => ({ value: option.key, label: option.label }))}
            placeholder="Choose a type…"
          />
        )}
        <button type="submit" hidden aria-hidden />
      </form>
    </Modal>
  );
}
