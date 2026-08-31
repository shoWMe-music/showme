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
import { AddressAutocompleteField } from "../components/AddressAutocompleteField";
import { ProfileImageField } from "../components/ProfileImageField";
import { type ProfileLinkDraft, ProfileLinkListField } from "../components/ProfileLinkListField";
import {
  type ProfilePhotoDraft,
  ProfilePhotoGalleryField,
} from "../components/ProfilePhotoGalleryField";
import { ProfilePublicPreview } from "../components/ProfilePublicPreview";
import { ProfileRoomsCard } from "../components/ProfileRoomsCard";
import { type ProfileSetupDraft, ProfileSetupsField } from "../components/ProfileSetupsField";
import { ProfileVideoListField } from "../components/ProfileVideoListField";
import {
  EMPTY_VENUE_DETAILS,
  type VenueDetailsDraft,
  VenueDetailsFields,
} from "../components/VenueDetailsFields";
import { VenueNotesField } from "../components/VenueNotesField";
import { ErrorState, LoadingState } from "../components/states";
import { useProfileImageUpload } from "../components/useProfileImageUpload";
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
function readDetails(details: unknown): {
  genres: string[];
  setups: ProfileSetupDraft[];
  tagline: string;
} {
  if (!details || typeof details !== "object") return { genres: [], setups: [], tagline: "" };
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
  const tagline = typeof record.tagline === "string" ? record.tagline : "";
  return { genres, setups, tagline };
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
                  {/* The owner's own picture when they have one — `Avatar`
                      ignores `initials` once `src` is set, so the letters stay
                      as the fallback for a profile with no logo yet. */}
                  <Avatar
                    src={profile.avatarUrl ?? undefined}
                    alt=""
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
                  as you go. It is also the ONLY place a capacity is entered —
                  the form above used to ask for one too, and so did a third list
                  of "capacity setups". Only a place has rooms: a promoter or a
                  booking agency is an organisation, not a building. */}
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
      comingEvents={preview.data.profile.upcomingShows}
      isPublic={preview.data.isPublic}
      withheldVenueDetails={preview.data.withheldVenueDetails}
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

/** A number input can still hold something unparseable; never send NaN. */
function toOptionalInteger(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fromVenueDraft(draft: VenueDetailsDraft) {
  return {
    // No `capacity` and no `capacitySetups`: both belong to a ROOM now, and the
    // rooms card writes them straight to `/profiles/:id/stages`. The profile's
    // own capacity column is the largest room, derived by the server.
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

/**
 * The avatar / banner as the form holds it, which is NOT what the wire holds.
 *
 * `previewUrl` is only how to draw the picture right now. For an uploaded one
 * that is a signed URL which stops working in fifteen minutes — so it must never
 * be sent back, and `touched` is what stops it.
 *
 * WHY `touched` EXISTS, found by driving the screen: the API resolves the
 * file-then-URL ladder into one `avatarUrl`, so a file-backed picture arrives
 * here looking exactly like an external address. Sending it back unconditionally
 * wrote the SIGNED URL into `profiles.avatar_url` and cleared `avatar_file_id` —
 * a profile picture that worked until the URL expired and then broke for good.
 * A PATCH is partial, so the honest answer is to send nothing at all for a field
 * the owner did not touch: `touched` is false until they upload or remove.
 */
interface ProfileImageDraft {
  touched: boolean;
  fileId: string | null;
  externalUrl: string | null;
  previewUrl: string | null;
}

/** The owner took the picture off — both halves cleared, and that IS a change. */
const REMOVED_IMAGE_DRAFT: ProfileImageDraft = {
  touched: true,
  fileId: null,
  externalUrl: null,
  previewUrl: null,
};

/** Seed from what the server sent: something to draw, and nothing to save. */
function toImageDraft(resolvedUrl: string | null): ProfileImageDraft {
  return { touched: false, fileId: null, externalUrl: null, previewUrl: resolvedUrl };
}

/** The two picture fields, folded into the PATCH body only when they changed. */
function imageFields(
  avatar: ProfileImageDraft,
  banner: ProfileImageDraft,
): Record<string, string | null> {
  return {
    ...(avatar.touched ? { avatarFileId: avatar.fileId, avatarUrl: avatar.externalUrl } : {}),
    ...(banner.touched ? { bannerFileId: banner.fileId, bannerUrl: banner.externalUrl } : {}),
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
  const [tagline, setTagline] = useState(initial.tagline);
  // Pictures are FILES now. The draft holds the id that will be saved plus the
  // signed URL that draws it — the URL is not what is stored, because it expires.
  const [avatar, setAvatar] = useState<ProfileImageDraft>(() => toImageDraft(profile.avatarUrl));
  const [banner, setBanner] = useState<ProfileImageDraft>(() => toImageDraft(profile.bannerUrl));
  const [street, setStreet] = useState(profile.location?.street ?? "");
  const [postcode, setPostcode] = useState(profile.location?.postcode ?? "");
  /**
   * The map pin, and the reason the address field is an autocomplete rather than
   * a text box. `profile_locations.lat`/`.lng` have existed since migration 0014
   * and were never written by anything, because nothing could turn a typed
   * street into a pair of numbers — so every venue in the database has null
   * coordinates today.
   *
   * Null is therefore a first-class value here, not a failure. It is what a
   * hand-typed address means, and what an unedited old profile keeps.
   */
  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(
    profile.location?.lat != null && profile.location?.lng != null
      ? { lat: profile.location.lat, lng: profile.location.lng }
      : null,
  );
  const [city, setCity] = useState(profile.location?.city ?? "");
  const [country, setCountry] = useState(profile.location?.country ?? "");
  const [genres, setGenres] = useState(initial.genres.join(", "));
  const [setups, setSetups] = useState<ProfileSetupDraft[]>(initial.setups);
  const [links, setLinks] = useState<ProfileLinkDraft[]>(profile.socialLinks ?? []);
  const [photos, setPhotos] = useState<ProfilePhotoDraft[]>(profile.photos ?? []);
  const [videos, setVideos] = useState<string[]>(profile.videos ?? []);
  const [isPublic, setIsPublic] = useState(profile.isPublic);
  const [profileType, setProfileType] = useState(profile.type ?? "");
  const [venue, setVenue] = useState<VenueDetailsDraft>(() => toVenueDraft(profile.venueDetails));

  const upload = useProfileImageUpload(profile.id);

  /**
   * Upload one picture and point the avatar/banner at it. The bytes go to
   * storage immediately (that is what an upload is); the PROFILE only learns
   * about the file when the form is saved, so a picked-then-abandoned picture
   * leaves an orphaned object rather than a changed profile.
   */
  const pickImage = async (
    file: File,
    apply: (draft: ProfileImageDraft) => void,
  ): Promise<void> => {
    const fileId = await upload.upload(file);
    if (!fileId) return;
    // Drawn from the local file until the next save round-trips a signed URL —
    // the picture the owner just chose, not a placeholder standing in for it.
    apply({ touched: true, fileId, externalUrl: null, previewUrl: URL.createObjectURL(file) });
  };

  const addPhotos = async (files: File[]): Promise<void> => {
    for (const file of files) {
      const fileId = await upload.upload(file);
      if (!fileId) return;
      setPhotos((current) => [...current, { fileId, url: URL.createObjectURL(file) }]);
    }
  };

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
    setTagline(details.tagline);
    setAvatar(toImageDraft(profile.avatarUrl));
    setBanner(toImageDraft(profile.bannerUrl));
    setStreet(profile.location?.street ?? "");
    setPostcode(profile.location?.postcode ?? "");
    setCoordinates(
      profile.location?.lat != null && profile.location?.lng != null
        ? { lat: profile.location.lat, lng: profile.location.lng }
        : null,
    );
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
        // Only when the owner actually changed one — see `ProfileImageDraft`.
        ...imageFields(avatar, banner),
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
          // Sent every time, and null whenever the address was typed rather than
          // picked. Anything reading these must cope with null — see the
          // `coordinates` docstring: that is the state of every existing venue.
          lat: showsVenueFields ? (coordinates?.lat ?? null) : null,
          lng: showsVenueFields ? (coordinates?.lng ?? null) : null,
        },
        details: { ...baseDetails, genres: genreList },
        // Its own field, not a key we hand-merge into the blob above — the API
        // owns that merge for the same reason it owns `setups`.
        tagline: blankToNull(tagline),
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
        // A tile is saved as the FILE it holds, never as the URL it is drawn
        // with. A tile that is neither (its file row vanished) is dropped rather
        // than sent as an empty photo the server would refuse.
        photos: photos
          .map((photo) =>
            photo.fileId ? { fileId: photo.fileId } : photo.url ? { url: photo.url } : null,
          )
          .filter((photo): photo is { fileId: string } | { url: string } => photo !== null),
        videos,
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
        {/* The default, stated once. Everything from here to the venue block is
            published: name, tagline, bio, pictures, genres, links, photos,
            videos, city and country. Only the venue block below has fields that
            stop short of the open web, and each of its groups says so on its own
            heading rather than in a suffix somebody had to remember to type. */}
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "var(--dim)",
            borderLeft: "2px solid var(--border-strong)",
            paddingLeft: 10,
          }}
        >
          Everything on this form is <strong>published to your public page</strong> unless a heading
          below says otherwise.
        </p>

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

        {/* The one line under the name on the public page. Above the bio because
            that is the order the page reads in, and because an owner who fills
            in one long field and stops has filled in the wrong one. */}
        <TextField
          label="Tagline"
          value={tagline}
          maxLength={140}
          placeholder="One line under your name — what you sound like, or what the room is for"
          onChange={(event) => setTagline(event.target.value)}
        />

        <VenueNotesField
          label="Bio"
          value={bio}
          rows={4}
          placeholder="Tell people what this profile is about"
          onChange={setBio}
        />

        {/* Pictures — uploaded to this profile's own storage folder. They used
            to be two text boxes asking for a URL, which meant a venue could only
            show a face it was already hosting somewhere else. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 18,
          }}
        >
          <ProfileImageField
            label="Profile picture"
            hint="Square works best. Shown on your page and beside your name everywhere."
            previewUrl={avatar.previewUrl}
            shape="avatar"
            isUploading={upload.isUploading}
            onPick={(file) => pickImage(file, setAvatar)}
            onRemove={() => setAvatar(REMOVED_IMAGE_DRAFT)}
          />
          <ProfileImageField
            label="Cover banner"
            hint="Wide — around 1500×500. It runs across the top of your page."
            previewUrl={banner.previewUrl}
            shape="banner"
            isUploading={upload.isUploading}
            onPick={(file) => pickImage(file, setBanner)}
            onRemove={() => setBanner(REMOVED_IMAGE_DRAFT)}
          />
        </div>
        {upload.error && (
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--brand-red)" }} role="alert">
            {upload.error}
          </p>
        )}

        <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "4px 0" }} />

        {/* City and country are two fields because they are two columns in
            `profile_locations`, and `country` is the ISO code that decides the
            event timezone and an agent's territory — it cannot be prose.
            The STREET is not here: for a place it belongs with the rest of what
            the public sees, so it is rendered inside `VenueDetailsFields`'
            public section below, under a heading that says so. */}
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

        <ProfilePhotoGalleryField
          value={photos}
          onChange={setPhotos}
          isUploading={upload.isUploading}
          onPick={addPhotos}
        />

        <ProfileVideoListField value={videos} onChange={setVideos} />

        {showsSetups && (
          <>
            <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "4px 0" }} />
            <ProfileSetupsField value={setups} onChange={setSetups} />
          </>
        )}

        {showsVenueFields && (
          <>
            <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "4px 0" }} />
            <VenueDetailsFields
              value={venue}
              onChange={setVenue}
              addressField={
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: 14,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <AddressAutocompleteField
                      label="Street address"
                      value={street}
                      placeholder="Start typing — e.g. Hornsgatan 12"
                      countryHint={country || undefined}
                      hint="Pick a suggestion to drop your pin on the map. Typing it by hand still saves the address."
                      onChangeText={(next) => {
                        setStreet(next);
                        // Typed, not picked: whatever pin was attached describes
                        // a different doorstep now, so it goes rather than
                        // quietly mislocating the venue.
                        setCoordinates(null);
                      }}
                      onSelect={(suggestion) => {
                        // Only what the suggestion actually carries. Picking a
                        // CITY (a valid choice — it is how you pin a room the
                        // provider has never indexed) has no street, and
                        // writing its full label into the street box would
                        // replace a correct doorstep with "Stockholm, Sweden".
                        if (suggestion.street) setStreet(suggestion.street);
                        if (suggestion.postcode) setPostcode(suggestion.postcode);
                        if (suggestion.city) setCity(suggestion.city);
                        if (suggestion.country) setCountry(suggestion.country);
                        setCoordinates({ lat: suggestion.lat, lng: suggestion.lng });
                      }}
                      footer={
                        coordinates ? (
                          <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--dim)" }}>
                            Pinned at {coordinates.lat.toFixed(5)}, {coordinates.lng.toFixed(5)}.
                          </p>
                        ) : null
                      }
                    />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <TextField
                      label="Postcode"
                      value={postcode}
                      placeholder="e.g. 118 20"
                      onChange={(event) => setPostcode(event.target.value)}
                    />
                  </div>
                </div>
              }
            />
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
