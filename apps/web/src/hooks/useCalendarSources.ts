import {
  type getApiV1Profiles,
  getGetApiV1ProfilesIdStagesQueryOptions,
  useGetApiV1Profiles,
} from "@showme/api-client";
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
  /**
   * This room's headline capacity, null when none is recorded and on every entry that is
   * not a room. `GET /profiles/:id/stages` has always returned it; it was dropped on the
   * way in until a shared link needed to say "Small Room (200 cap)" (`123qy9rpqp0` §2).
   */
  capacity: number | null;
  /** Every room of the owning venue — what "the venue is full" is measured against. */
  rooms: RoomId[];
  /** True when the events on this calendar are the ones PLACED AT this profile. */
  isVenue: boolean;
}

export interface CalendarSourcesView {
  sources: CalendarSource[];
}

/** `profileId:room` — parsed nowhere, compared everywhere. */
function sourceValue(profileId: string, room: RoomId | typeof WHOLE_VENUE): string {
  return `${profileId}:${room}`;
}

/**
 * The venue's own entry. Named "All rooms" rather than the venue's name because the venue
 * is named by the select beside it, and this means something different from the rooms
 * beneath: the venue is free while ANY room is free.
 */
const WHOLE_VENUE_LABEL = "All rooms";

/**
 * "The Lantern Hall · Main Room" — the one full-name format, used wherever there is no
 * venue named next to the room.
 *
 * A middot, and the room's own capitalisation. It used to be two em-dashed formats with
 * the whole-venue one lowercased, which made the share modal's own heading read
 * *"Available dates — The Lantern Hall — all rooms"* — two dashes doing two different
 * jobs in one line.
 */
function fullLabelFor(profileName: string, roomLabel: string): string {
  return `${profileName} · ${roomLabel}`;
}

/** A venue with no rooms recorded yet is one space, and says so plainly. */
function calendarsForProfile(
  profile: Profile,
  rooms: { id: string; name: string; capacity?: number | null }[],
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
        capacity: null,
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
      fullLabel: fullLabelFor(profile.name, WHOLE_VENUE_LABEL),
      room: WHOLE_VENUE,
      // The building has no capacity of its own — only its rooms do (migration 0029).
      capacity: null,
    },
    ...rooms.map((room) => ({
      ...base,
      value: sourceValue(profile.id, room.id),
      label: room.name,
      fullLabel: fullLabelFor(profile.name, room.name),
      room: room.id,
      capacity: room.capacity ?? null,
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
          .map((room) => `${room.id}/${room.name}/${room.capacity ?? ""}`)
          .join(",")}`,
    )
    .join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the signature above, on purpose.
  const roomsByProfileId = useMemo(() => {
    const rooms = new Map<string, { id: string; name: string; capacity: number | null }[]>();
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

  return { sources };
}
