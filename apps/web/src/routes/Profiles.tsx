import {
  type getApiV1Profiles,
  type getApiV1ProfilesId,
  useGetApiV1Profiles,
  useGetApiV1ProfilesId,
  useGetApiV1ProfilesIdPublicPreview,
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
import { type FormEvent, useEffect, useState } from "react";
import { SegmentedToggle } from "../components";
import { type ProfileLinkDraft, ProfileLinkListField } from "../components/ProfileLinkListField";
import { ProfileMediaField } from "../components/ProfileMediaField";
import { ProfilePublicPreview } from "../components/ProfilePublicPreview";
import { ProfileRoomsCard } from "../components/ProfileRoomsCard";
import {
  type ProfileCapacitySetupDraft,
  ProfileCapacitySetupsField,
  type ProfileSetupDraft,
  ProfileSetupsField,
} from "../components/ProfileSetupsField";
import {
  EMPTY_VENUE_DETAILS,
  type VenueDetailsDraft,
  VenueDetailsFields,
} from "../components/VenueDetailsFields";
import { VenueNotesField } from "../components/VenueNotesField";
import { ErrorState, LoadingState } from "../components/states";
import { getActiveProfileId, setActiveProfileId } from "../lib/activeProfile";
import { errorMessage } from "../lib/errors";

type Profile = Awaited<ReturnType<typeof getApiV1Profiles>>[number];
type ProfileDetail = Awaited<ReturnType<typeof getApiV1ProfilesId>>;

/**
 * EDIT or PREVIEW. It used to be "Public view" / "Private (edit)", and that was a
 * claim the screen could not back: the "Public view" tab rendered the MEMBER
 * payload — the same one the editor uses — so it listed draft events under a
 * heading that said PUBLIC, and it would have shown the booking contact and the
 * artist load-in notes the moment anyone added those cards.
 *
 * Two honest states instead. **Edit** is the form. **Preview** is a server round
 * trip to `GET /profiles/:id/public-preview`, which runs the same
 * `serializePublicProfile` the anonymous page runs — so it can only show what a
 * stranger would get, and it says out loud when the profile is not published.
 */
type ViewMode = "edit" | "preview";

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

/**
 * `details` is untyped jsonb — the read-with-parent leaves of a profile. Read the
 * keys we know about defensively; anything absent becomes an empty field.
 *
 * `location` is deliberately NOT read here. It used to be, and that was the bug:
 * the editor wrote a string into this blob while the seed (and every query in the
 * API) used the `profile_locations` table, so a venue with a location rendered
 * "No location set". The profile route returns `profile.location` from that table
 * and migration 0010 moved the stray strings into it.
 */
function readDetails(details: unknown): { genres: string[]; setups: ProfileSetupDraft[] } {
  if (!details || typeof details !== "object") return { genres: [], setups: [] };
  const record = details as Record<string, unknown>;
  const genres = Array.isArray(record.genres)
    ? record.genres.filter((genre): genre is string => typeof genre === "string")
    : [];
  const setups: ProfileSetupDraft[] = Array.isArray(record.setups)
    ? record.setups.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const setup = entry as Record<string, unknown>;
        if (typeof setup.name !== "string" || setup.name.trim() === "") return [];
        return [
          {
            name: setup.name,
            headcount: typeof setup.headcount === "number" ? String(setup.headcount) : "",
          },
        ];
      })
    : [];
  return { genres, setups };
}

export function Profiles() {
  const profiles = useGetApiV1Profiles();
  const [creating, setCreating] = useState(false);
  // Edit is the default: "My Profiles" is where you go to change one. Preview is
  // the check you do afterwards.
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
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
  };

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
              { value: "edit", label: "Edit" },
              { value: "preview", label: "Preview" },
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
          {viewMode === "preview" ? (
            selectedId ? (
              <ProfilePreviewPanel
                profileId={selectedId}
                tone={CHIP_TONES[selectedIndex % CHIP_TONES.length] ?? "brand"}
              />
            ) : null
          ) : detail.isPending ? (
            <LoadingState label="Loading profile" />
          ) : detail.isError ? (
            <ErrorState error={detail.error} title="Couldn't load this profile" />
          ) : detail.data ? (
            <>
              <ProfileEditor profile={detail.data} onSaved={() => void detail.refetch()} />
              {/* Its own card, not a field in the form above: rooms are separate
                  records that events point at (`events.stage_id`), so they save
                  as you go. Only a place has them — a promoter or a booking
                  agency is an organisation, not a building. */}
              {isPlaceProfile(detail.data.kind, detail.data.type) && (
                <ProfileRoomsCard profileId={detail.data.id} />
              )}
            </>
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

/**
 * Fetches the public projection and hands it to the presentational preview.
 *
 * It is its own component so the query only runs while Preview is showing — the
 * screen is Edit by default, and there is no reason to ask the server what the
 * world sees until someone asks to look.
 */
function ProfilePreviewPanel({ profileId, tone }: { profileId: string; tone: AvatarTone }) {
  const preview = useGetApiV1ProfilesIdPublicPreview(profileId);

  if (preview.isPending) return <LoadingState label="Loading preview" />;
  if (preview.isError) {
    return <ErrorState error={preview.error} title="Couldn't load the public preview" />;
  }
  if (!preview.data) return null;

  return (
    <ProfilePublicPreview
      profile={preview.data.profile}
      comingEvents={preview.data.comingEvents}
      isPublic={preview.data.isPublic}
      tone={tone}
    />
  );
}

/* -------------------------------------------------------------------- editor */

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

function toCapacitySetupDrafts(
  venueDetails: ProfileDetail["venueDetails"],
): ProfileCapacitySetupDraft[] {
  return (venueDetails?.capacitySetups ?? []).map((setup) => ({
    id: setup.id,
    name: setup.name,
    capacitySitting: setup.capacitySitting === null ? "" : String(setup.capacitySitting),
    capacityStanding: setup.capacityStanding === null ? "" : String(setup.capacityStanding),
    isMain: setup.isMain,
    notes: setup.notes ?? "",
  }));
}

/** Form draft → API body. An emptied field is sent as `null`, not as `""`:
 * "" would be a value the venue never chose, and the read side distinguishes
 * "no curfew recorded" from "the curfew is the empty string". */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** A number input can still hold something unparseable; never send NaN. */
function toOptionalInteger(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fromVenueDraft(draft: VenueDetailsDraft, capacitySetups: ProfileCapacitySetupDraft[]) {
  return {
    capacity: toOptionalInteger(draft.capacity),
    soundSystem: blankToNull(draft.soundSystem),
    curfew: blankToNull(draft.curfew),
    amenities: draft.amenities,
    dealTypes: draft.dealTypes,
    // Half-typed rows (no name yet) are dropped rather than rejected — the owner
    // clicked "add" and then saved, which is not an error worth a red box.
    capacitySetups: capacitySetups
      .filter((setup) => setup.name.trim() !== "")
      .map((setup) => ({
        id: setup.id,
        name: setup.name.trim(),
        capacitySitting: toOptionalInteger(setup.capacitySitting),
        capacityStanding: toOptionalInteger(setup.capacityStanding),
        isMain: setup.isMain,
        notes: blankToNull(setup.notes),
      })),
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
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? "");
  const [bannerUrl, setBannerUrl] = useState(profile.bannerUrl ?? "");
  const [street, setStreet] = useState(profile.location?.street ?? "");
  const [postcode, setPostcode] = useState(profile.location?.postcode ?? "");
  const [city, setCity] = useState(profile.location?.city ?? "");
  const [country, setCountry] = useState(profile.location?.country ?? "");
  const [genres, setGenres] = useState(initial.genres.join(", "));
  const [setups, setSetups] = useState<ProfileSetupDraft[]>(initial.setups);
  const [links, setLinks] = useState<ProfileLinkDraft[]>(profile.socialLinks ?? []);
  const [photos, setPhotos] = useState<string[]>(profile.photos ?? []);
  const [videos, setVideos] = useState<string[]>(profile.videos ?? []);
  const [isPublic, setIsPublic] = useState(profile.isPublic);
  const [profileType, setProfileType] = useState(profile.type ?? "");
  const [venue, setVenue] = useState<VenueDetailsDraft>(() => toVenueDraft(profile.venueDetails));
  const [capacitySetups, setCapacitySetups] = useState<ProfileCapacitySetupDraft[]>(() =>
    toCapacitySetupDrafts(profile.venueDetails),
  );

  // Only a place has a capacity and a curfew — a promoter or a booking agency is
  // an organisation, not a room. The same test decides whether the street address
  // is asked for at all, and (server-side) whether it is published.
  const showsVenueFields = isPlaceProfile(profile.kind, profileType || profile.type);
  const showsSetups = profile.kind === "performer";
  const typeOptions = profileTypesForKind(profile.kind);

  /**
   * Re-seed the form when the profile the screen is showing actually CHANGES —
   * a different profile selected, or a save that came back with new values.
   *
   * Keyed on `id` + `updatedAt`, NOT on the `profile` object. React Query hands
   * back a fresh object identity on every refetch, and it refetches on window
   * focus — so depending on the object meant that alt-tabbing away and back
   * silently threw away everything typed since the last save. (Found doing
   * exactly that: fields filled in one step were empty by the next.) `updatedAt`
   * is the honest test for "the server's copy moved": a background refetch that
   * returns the same row leaves the draft alone, and a save bumps it and reseeds.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on id+updatedAt on purpose — see above.
  useEffect(() => {
    const details = readDetails(profile.details);
    setName(profile.name);
    setBio(profile.bio ?? "");
    setAvatarUrl(profile.avatarUrl ?? "");
    setBannerUrl(profile.bannerUrl ?? "");
    setStreet(profile.location?.street ?? "");
    setPostcode(profile.location?.postcode ?? "");
    setCity(profile.location?.city ?? "");
    setCountry(profile.location?.country ?? "");
    setGenres(details.genres.join(", "));
    setSetups(details.setups);
    setLinks(profile.socialLinks ?? []);
    setPhotos(profile.photos ?? []);
    setVideos(profile.videos ?? []);
    setIsPublic(profile.isPublic);
    setProfileType(profile.type ?? "");
    setVenue(toVenueDraft(profile.venueDetails));
    setCapacitySetups(toCapacitySetupDrafts(profile.venueDetails));
  }, [profile.id, profile.updatedAt]);

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
        avatarUrl: blankToNull(avatarUrl),
        bannerUrl: blankToNull(bannerUrl),
        isPublic,
        ...(profileType ? { type: profileType } : {}),
        // The location goes to `profile_locations` through its own field, NOT
        // into `details` — that split is the whole point of the 0010 fix. Street
        // and postcode are only sent for a place: a profile that is not a room
        // must not keep a stale doorstep on its row.
        location: {
          street: showsVenueFields ? blankToNull(street) : null,
          postcode: showsVenueFields ? blankToNull(postcode) : null,
          city: blankToNull(city),
          country: blankToNull(country),
        },
        details: { ...baseDetails, genres: genreList },
        // `setups` rides beside `details`; the API merges it in so the client
        // never hand-edits the jsonb blob.
        ...(showsSetups
          ? {
              setups: setups
                .filter((setup) => setup.name.trim() !== "")
                .map((setup) => ({
                  name: setup.name.trim(),
                  headcount: toOptionalInteger(setup.headcount),
                })),
            }
          : {}),
        socialLinks: links
          .filter((link) => link.platform.trim() !== "" && link.url.trim() !== "")
          .map((link) => ({ platform: link.platform.trim(), url: link.url.trim() })),
        photos,
        videos,
        ...(showsVenueFields ? { venueDetails: fromVenueDraft(venue, capacitySetups) } : {}),
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

        {/* Pictures. The old app had both and this rebuild had neither, so a
            profile could not carry a face at all. URLs for now — uploading is the
            `files` + signed-URL subsystem and is separate work; the columns and
            the rendering are the same either way. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 14,
          }}
        >
          <TextField
            label="Avatar image URL"
            value={avatarUrl}
            placeholder="https://…"
            onChange={(event) => setAvatarUrl(event.target.value)}
          />
          <TextField
            label="Banner image URL"
            value={bannerUrl}
            placeholder="https://… (wide — around 1500×500)"
            onChange={(event) => setBannerUrl(event.target.value)}
          />
        </div>

        <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "4px 0" }} />

        {/* City and country are two fields because they are two columns in
            `profile_locations`, and `country` is the ISO code that decides the
            event timezone and an agent's territory — it cannot be prose.
            Street and postcode appear for a place only: an audience has to find
            a venue, and a band's home address is not a listing. */}
        {showsVenueFields && (
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
            <TextField
              label="Street address"
              value={street}
              placeholder="e.g. Hornsgatan 12"
              onChange={(event) => setStreet(event.target.value)}
            />
            <TextField
              label="Postcode"
              value={postcode}
              placeholder="e.g. 118 20"
              onChange={(event) => setPostcode(event.target.value)}
            />
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
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

        <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "4px 0" }} />

        <ProfileLinkListField value={links} onChange={setLinks} />

        <ProfileMediaField
          label="Photos"
          hint="Shown on your public page, in this order. The first one leads."
          placeholder="https://… image URL"
          value={photos}
          onChange={setPhotos}
          preview="image"
        />

        <ProfileMediaField
          label="Videos"
          hint="YouTube and Vimeo links play inline; anything else appears as a link."
          placeholder="https://youtube.com/watch?v=… or https://vimeo.com/…"
          value={videos}
          onChange={setVideos}
          preview="link"
        />

        {showsSetups && (
          <>
            <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "4px 0" }} />
            <ProfileSetupsField value={setups} onChange={setSetups} />
          </>
        )}

        {showsVenueFields && (
          <>
            <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "4px 0" }} />
            <VenueDetailsFields value={venue} onChange={setVenue} />
            <ProfileCapacitySetupsField value={capacitySetups} onChange={setCapacitySetups} />
            <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "4px 0" }} />
          </>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Toggle checked={isPublic} onChange={setIsPublic} label="Publish this profile publicly" />
          <span style={{ color: "var(--text)", fontSize: 14 }}>Publish this profile publicly</span>
        </div>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--dim)" }}>
          Not sure what goes out? Switch to <strong>Preview</strong> — it is the real public page,
          rendered from what the server would actually hand a stranger.
        </p>
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
