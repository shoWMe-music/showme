import {
  type GetApiV1EventsIdSetlists200Item,
  getGetApiV1EventsIdSetlistsQueryKey,
  useGetApiV1EventsId,
  useGetApiV1EventsIdSetlists,
  usePutApiV1EventsIdSetlists,
} from "@showme/api-client";
import { formatDurationClock, parseDurationText, parseSetlistWorks } from "@showme/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * ONE event's setlists — the data behind the performer's Setlists screen and the
 * event workspace's Setlist tab, which are the same surface reached two ways.
 *
 * ## What the server decides, and what this only renders
 *
 * `GET /events/:id/setlists` already answers "which of these may you see": the
 * act gets its own, the filing operator gets every act's, and anyone else gets
 * only what was explicitly shared to them (`routes/setlists.ts`). Each row says
 * whether it is the caller's (`mine`) and which act wrote it (`performerName`),
 * so nothing here re-derives an authorization answer from a roster — a screen
 * that decided for itself which row was editable would be a second, weaker copy
 * of the rule.
 *
 * The one thing the list cannot say is whether somebody with NO setlist yet may
 * start one, which is the `setlist.author` capability on the event.
 *
 * ## The draft is local until it is saved
 *
 * `items` is `jsonb` and the whole array is written at once (`PUT` upserts the
 * entire set), so adding a song, retitling one and moving one up are edits to a
 * draft held here — not five round trips. `isDirty` is what the Save button
 * reads, and the draft re-seeds from the server whenever a new version arrives
 * and nothing local is pending.
 *
 * A length is carried as the TEXT the writer typed, not as seconds: `3:` is a
 * legal half-typed value and reformatting it under the cursor is the bug every
 * duration field starts with. It becomes seconds once, on save, through the
 * shared `parseDurationText` the filing reader also uses.
 */

/** One song as the performer is writing it. */
export interface SetlistSong {
  /** Client-side only, so a row keeps its identity across a reorder. Never stored. */
  readonly key: string;
  readonly title: string;
  /** Exactly what is in the field — `3:45`, `4`, or empty for "not recorded". */
  readonly durationText: string;
}

export type SetlistRow = GetApiV1EventsIdSetlists200Item;

export interface EventSetlistView {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  /** May the reader write a setlist here at all (`setlist.author`)? */
  readonly canAuthor: boolean;
  /**
   * Is the reader the operator who FILES this show's performed-works report
   * (`performance_report.file`)? That is the standing the list route serves
   * every act's set on, so it is also what decides whether an empty tab means
   * "nobody has written one" or "nothing has been shared with you".
   */
  readonly canReadEveryAct: boolean;
  /** The caller's own saved setlist, or null when they have not written one. */
  readonly ownSetlist: SetlistRow | null;
  /** Everyone else's, read-only — every act for the filing operator, a shared one for crew. */
  readonly otherSetlists: readonly SetlistRow[];
  /** The working copy the editor renders. */
  readonly songs: readonly SetlistSong[];
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly saveError: unknown;
  /** Total runtime, or null when not one song carried a readable length. */
  readonly totalSeconds: number | null;
  readonly addSong: () => void;
  readonly updateTitle: (index: number, title: string) => void;
  readonly updateDuration: (index: number, durationText: string) => void;
  readonly removeSong: (index: number) => void;
  /** Move one song to another position. Out-of-range indexes are no-ops. */
  readonly moveSong: (from: number, to: number) => void;
  readonly save: () => void;
  readonly discard: () => void;
}

/**
 * The stored `jsonb` as songs, through the SAME reader the performed-works
 * report uses. Deliberately not a second, looser parse of the column: what the
 * writer sees in the field is then exactly what the report would say about that
 * entry, down to the "Untitled" a titleless row is read as.
 */
function songsFrom(row: SetlistRow | null): SetlistSong[] {
  const items = Array.isArray(row?.items) ? row.items : [];
  return parseSetlistWorks(items).map((work, index) => ({
    key: `saved-${index}`,
    title: work.title,
    durationText: formatDurationClock(work.durationSeconds),
  }));
}

/** Songs back to the `{ title, duration }` shape the seed and the reader agree on. */
function itemsFrom(songs: readonly SetlistSong[]): { title: string; duration?: number }[] {
  return (
    songs
      // Blank rows are the residue of an "+ Add song" the writer changed their mind
      // about; they must never reach a society's report as "Untitled".
      .filter((song) => song.title.trim().length > 0)
      .map((song) => {
        const seconds = parseDurationText(song.durationText);
        return {
          title: song.title.trim(),
          // Omitted rather than nulled when unknown: a `duration: null` would be one
          // more shape the tolerant reader has to carry, for no gain.
          ...(seconds == null ? {} : { duration: seconds }),
        };
      })
  );
}

function sameSongs(left: readonly SetlistSong[], right: readonly SetlistSong[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (song, index) =>
        song.title === right[index]?.title && song.durationText === right[index]?.durationText,
    )
  );
}

export function useEventSetlist(eventId: string): EventSetlistView {
  const queryClient = useQueryClient();
  const list = useGetApiV1EventsIdSetlists(eventId);
  // Deduped by TanStack against the same key the event workspace already holds,
  // so on the event screen this costs nothing, and on the Setlists screen it is
  // the one request that says whether the reader may write here at all.
  const event = useGetApiV1EventsId(eventId);

  const ownSetlist = useMemo(() => list.data?.find((row) => row.mine) ?? null, [list.data]);
  const otherSetlists = useMemo(() => list.data?.filter((row) => !row.mine) ?? [], [list.data]);
  const saved = useMemo(() => songsFrom(ownSetlist), [ownSetlist]);

  const [draft, setDraft] = useState<SetlistSong[]>(saved);
  const [dirty, setDirty] = useState(false);
  const nextKey = useRef(0);

  // Re-seed from the server, but ONLY while nothing local is pending: a
  // background refetch must not blow away a half-typed song, and an edit made
  // in another window should land rather than be overwritten by a stale draft.
  useEffect(() => {
    if (dirty) return;
    setDraft(saved);
  }, [saved, dirty]);

  const save = usePutApiV1EventsIdSetlists({
    mutation: {
      onSuccess: () => {
        setDirty(false);
        void queryClient.invalidateQueries({
          queryKey: getGetApiV1EventsIdSetlistsQueryKey(eventId),
        });
      },
    },
  });

  const edit = useCallback((next: (songs: SetlistSong[]) => SetlistSong[]) => {
    setDraft((songs) => next([...songs]));
    setDirty(true);
  }, []);

  const capabilities = event.data?.capabilities ?? [];
  const readable = draft
    .map((song) => parseDurationText(song.durationText))
    .filter((seconds): seconds is number => seconds != null);

  return {
    isPending: list.isPending || event.isPending,
    isError: list.isError,
    error: list.error,
    canAuthor: capabilities.includes("setlist.author"),
    canReadEveryAct: capabilities.includes("performance_report.file"),
    ownSetlist,
    otherSetlists,
    songs: draft,
    isDirty: dirty && !sameSongs(draft, saved),
    isSaving: save.isPending,
    saveError: save.error,
    totalSeconds:
      readable.length === 0 ? null : readable.reduce((sum, seconds) => sum + seconds, 0),
    addSong: () =>
      edit((songs) => {
        nextKey.current += 1;
        return [...songs, { key: `draft-${nextKey.current}`, title: "", durationText: "" }];
      }),
    updateTitle: (index, title) =>
      edit((songs) => songs.map((song, at) => (at === index ? { ...song, title } : song))),
    updateDuration: (index, durationText) =>
      edit((songs) => songs.map((song, at) => (at === index ? { ...song, durationText } : song))),
    removeSong: (index) => edit((songs) => songs.filter((_, at) => at !== index)),
    moveSong: (from, to) =>
      edit((songs) => {
        if (from === to || from < 0 || to < 0 || from >= songs.length || to >= songs.length) {
          return songs;
        }
        const [moved] = songs.splice(from, 1);
        if (!moved) return songs;
        songs.splice(to, 0, moved);
        return songs;
      }),
    save: () => save.mutate({ id: eventId, data: { items: itemsFrom(draft) } }),
    discard: () => {
      setDraft(saved);
      setDirty(false);
    },
  };
}
