import {
  type getApiV1Profiles,
  getGetApiV1ProfilesIdStagesQueryOptions,
  useGetApiV1Profiles,
} from "@showme/api-client";
import type { SelectOption } from "@showme/design-system";
import { type RoomId, WHOLE_VENUE, isPlaceProfile } from "@showme/shared";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

/**
 * THE CALENDARS A USER ACTUALLY HAS.
 *
 * This replaces three hard-coded labels — "Promoter events / Performer shows /
 * Venue bookings" — that were copied from the design prototype and were never
 * calendars at all: they describe the acting profile's ROLE on an event, which
 * answers a different question and, worse, one the events list cannot answer.
 *
 * A calendar is a thing that can be double-booked. For a venue that is a ROOM:
 * a hall and a basement each hold their own show on the same Friday, so each has
 * its own free nights. For a performer, a crew member, a promoter or an agent
 * there is exactly one — they can only be in one place at a time — and it is
 * their own schedule.
 *
 * THE PRIVACY LINE. The list is built from `GET /profiles`, which returns the
 * profiles the caller is a MEMBER of, and rooms are then read per profile from
 * `GET /profiles/:id/stages`, which 404s for a non-member. So a performer booked
 * at a venue sees their own schedule and learns nothing about that venue's
 * rooms — a venue's internal geography is its own. A crew member employed BY the
 * venue does see them: staff of the house, not an arm's-length counterparty.
 *
 * WHY THAT LINE AND NOT A WIDER ONE. Rooms are not financials, so the founders'
 * transparency rule (`docs/meeting-2026-08-settlements-and-deals.md`, 00:21:42
 * and 00:25:48 — binding, and later than `docs/decisions.md`) does not govern
 * this directly. But its SHAPE does, and it is the closest rule there is:
 * disclosure is bounded by what you are a party to. An operator sees everything
 * of theirs; a collaborator sees "only the portions relevant to their own
 * deals". A venue's room roster is not a portion of anybody's deal — it is the
 * standing inventory of a building, including rooms the reader has no booking in
 * and may be competing for. So membership of the venue profile is the boundary,
 * and it lands where that rule would: the house sees its own geography, a
 * counterparty sees their own calendar.
 *
 * The one thing that rule DOES imply and this cannot yet deliver: the room of
 * the event you are actually on is relevant to you, and a party who is not a
 * venue member still reads "Assigned" rather than "Main Hall", because
 * `serializeEvent` carries `stageId` and no name. Closing that means widening
 * the event serializer, not this list.
 */

type Profile = Awaited<ReturnType<typeof getApiV1Profiles>>[number];

/** One selectable calendar: a room, a whole venue, or a person's own schedule. */
export interface CalendarSource {
  /** Stable id for the `Select` and for the shared link — `profileId:room`. */
  value: string;
  /** What the dropdown shows for this entry alone ("Basement", "All rooms"). */
  label: string;
  /** The full name for anywhere without the venue heading above it. */
  fullLabel: string;
  profileId: string;
  profileName: string;
  profileSlug: string | null;
  profileIsPublic: boolean;
  /** A `stages.id`, or `WHOLE_VENUE` for "any room here" / "my whole schedule". */
  room: RoomId | typeof WHOLE_VENUE;
  /** Every room of the owning venue — what "the venue is full" is measured against. */
  rooms: RoomId[];
  /** True when the events on this calendar are the ones PLACED AT this profile. */
  isVenue: boolean;
}

export interface CalendarSourcesView {
  sources: CalendarSource[];
  /** Ready for the DS `Select`, with an unselectable heading per multi-room venue. */
  options: SelectOption[];
  isPending: boolean;
  /** Look one up by its `value`, falling back to the first real calendar. */
  find: (value: string) => CalendarSource | undefined;
}

/** `profileId:room` — parsed nowhere, compared everywhere. */
function sourceValue(profileId: string, room: RoomId | typeof WHOLE_VENUE): string {
  return `${profileId}:${room}`;
}

/**
 * The venue's own entry. Named "All rooms" rather than the venue's name because
 * the venue's name is the heading directly above it, and it means something
 * different from the rooms beneath: the venue is free while ANY room is free.
 */
const WHOLE_VENUE_LABEL = "All rooms";

/** A venue with no rooms recorded yet is one space, and says so plainly. */
function calendarsForProfile(
  profile: Profile,
  rooms: { id: string; name: string }[],
): CalendarSource[] {
  const isVenue = isPlaceProfile(profile.kind, profile.type);
  const roomIds = rooms.map((room) => room.id);

  if (!isVenue || rooms.length === 0) {
    return [
      {
        value: sourceValue(profile.id, WHOLE_VENUE),
        label: profile.name,
        fullLabel: profile.name,
        profileId: profile.id,
        profileName: profile.name,
        profileSlug: profile.slug ?? null,
        profileIsPublic: profile.isPublic,
        room: WHOLE_VENUE,
        rooms: roomIds,
        isVenue,
      },
    ];
  }

  const base = {
    profileId: profile.id,
    profileName: profile.name,
    profileSlug: profile.slug ?? null,
    profileIsPublic: profile.isPublic,
    rooms: roomIds,
    isVenue: true,
  };

  return [
    {
      ...base,
      value: sourceValue(profile.id, WHOLE_VENUE),
      label: WHOLE_VENUE_LABEL,
      fullLabel: `${profile.name} — ${WHOLE_VENUE_LABEL.toLowerCase()}`,
      room: WHOLE_VENUE,
    },
    ...rooms.map((room) => ({
      ...base,
      value: sourceValue(profile.id, room.id),
      label: room.name,
      fullLabel: `${profile.name} — ${room.name}`,
      room: room.id,
    })),
  ];
}

export function useCalendarSources(): CalendarSourcesView {
  const profiles = useGetApiV1Profiles();
  const profileList = useMemo(() => profiles.data ?? [], [profiles.data]);

  // Rooms are asked for only where they can exist. A band has no rooms, and a
  // request per profile that cannot have one is a request that can only 400.
  const placeProfiles = useMemo(
    () => profileList.filter((profile) => isPlaceProfile(profile.kind, profile.type)),
    [profileList],
  );

  const roomQueries = useQueries({
    queries: placeProfiles.map((profile) => getGetApiV1ProfilesIdStagesQueryOptions(profile.id)),
  });

  /**
   * `useQueries` hands back a fresh array — and fresh result objects — on every
   * render, so depending on it directly would rebuild every calendar, and with
   * them the share modal's whole computation, on each keystroke elsewhere. The
   * signature is the only thing that actually matters here: which venue has which
   * rooms, by id and name.
   */
  const roomsSignature = placeProfiles
    .map(
      (profile, index) =>
        `${profile.id}=${(roomQueries[index]?.data ?? [])
          .map((room) => `${room.id}/${room.name}`)
          .join(",")}`,
    )
    .join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the signature above, on purpose.
  const roomsByProfileId = useMemo(() => {
    const rooms = new Map<string, { id: string; name: string }[]>();
    placeProfiles.forEach((profile, index) => {
      rooms.set(profile.id, roomQueries[index]?.data ?? []);
    });
    return rooms;
  }, [roomsSignature]);

  const sources = useMemo(
    () =>
      profileList.flatMap((profile) =>
        calendarsForProfile(profile, roomsByProfileId.get(profile.id) ?? []),
      ),
    [profileList, roomsByProfileId],
  );

  /**
   * Headings are disabled options rather than a nested structure: the DS `Select`
   * has one flat list, and a disabled row is exactly what a group label is — it
   * names the rows beneath it and cannot be chosen instead of them.
   */
  const options = useMemo<SelectOption[]>(() => {
    const built: SelectOption[] = [];
    for (const profile of profileList) {
      const forProfile = sources.filter((source) => source.profileId === profile.id);
      if (forProfile.length === 0) continue;
      if (forProfile.length === 1) {
        const [only] = forProfile;
        if (only) built.push({ value: only.value, label: only.label });
        continue;
      }
      built.push({
        value: `heading:${profile.id}`,
        label: profile.name,
        disabled: true,
        // Never selected, so it never needs to be found by typing.
        searchText: "",
      });
      for (const source of forProfile) {
        built.push({
          value: source.value,
          // A non-breaking-space indent (HTML collapses ordinary spaces).
          // The indent is what says "this room is inside the venue above".
          label: `\u00a0\u00a0${source.label}`,
          // The heading is what puts a room in its building, and a filtered list
          // may have dropped it — so each room stays searchable by venue name.
          searchText: source.fullLabel,
        });
      }
    }
    return built;
  }, [profileList, sources]);

  return {
    sources,
    options,
    isPending: profiles.isPending || roomQueries.some((query) => query.isPending),
    find: (value) => sources.find((source) => source.value === value) ?? sources[0],
  };
}
