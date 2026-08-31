import { Button, EmptyState, Icon, Input } from "@showme/design-system";
import { formatDurationClock, parseSetlistWorks } from "@showme/shared";
import type { EventSetlistView, SetlistRow } from "../hooks/useEventSetlist";
import { CardHeader, MonoPill, SectionCard } from "./eventUi";
import styles from "./setlistEditor.module.css";
import { ErrorState, LoadingState } from "./states";

/**
 * The setlist surface: the act's own set as an editable running order, plus
 * everyone else's read-only.
 *
 * DUMB ON PURPOSE. Every value, every derivation and every piece of reorder
 * state comes from `useEventSetlist`; this file decides only how a song row
 * looks. The two screens that render it — the performer's Setlists screen and
 * the event workspace's Setlist tab — are then the same surface reached two
 * ways rather than two implementations that drift.
 *
 * ## What a song carries, and what it deliberately does not
 *
 * A title and a length. A collecting society also needs the composer, the writer
 * shares and the ISWC for every work, and shoWMe holds none of them — the export
 * writes `NOT CAPTURED` in those columns and says so in the file
 * (`lib/proFilingExport.ts`). Capturing them here would be building the filing
 * half, which is deliberately dark (`lib/proFilingAvailability.ts`); until it is
 * turned on, an authoring field for writer shares would collect income data with
 * nowhere to go.
 */

function SongRow({
  index,
  song,
  count,
  view,
}: {
  index: number;
  song: EventSetlistView["songs"][number];
  count: number;
  view: EventSetlistView;
}) {
  return (
    <div className={styles.row}>
      <span className={styles.index}>{index + 1}</span>
      <Input
        className={styles.title}
        value={song.title}
        placeholder="Song title"
        aria-label={`Song ${index + 1} title`}
        onChange={(changed) => view.updateTitle(index, changed.target.value)}
      />
      <Input
        className={styles.duration}
        value={song.durationText}
        placeholder="3:45"
        inputMode="numeric"
        aria-label={`Song ${index + 1} length`}
        onChange={(changed) => view.updateDuration(index, changed.target.value)}
      />
      <div className={styles.actions}>
        {/* Buttons rather than a drag handle: a running order is reordered as
            often on a phone backstage as at a desk, and a native drag is the one
            gesture a touch screen does not give for free. Each is also a real
            control with a name, so the order can be changed from the keyboard. */}
        <Button
          variant="ghost"
          aria-label={`Move ${song.title || `song ${index + 1}`} up`}
          disabled={index === 0}
          onClick={() => view.moveSong(index, index - 1)}
        >
          <Icon name="chevron-down" size={14} style={{ transform: "rotate(180deg)" }} />
        </Button>
        <Button
          variant="ghost"
          aria-label={`Move ${song.title || `song ${index + 1}`} down`}
          disabled={index === count - 1}
          onClick={() => view.moveSong(index, index + 1)}
        >
          <Icon name="chevron-down" size={14} />
        </Button>
        <Button
          variant="ghost"
          aria-label={`Remove ${song.title || `song ${index + 1}`}`}
          onClick={() => view.removeSong(index)}
        >
          <Icon name="trash" size={14} />
        </Button>
      </div>
    </div>
  );
}

/** The act's own set — the only part of this screen anybody writes. */
function OwnSetlist({ view }: { view: EventSetlistView }) {
  return (
    <SectionCard>
      <CardHeader
        icon={<Icon name="music" size={16} />}
        title="Your setlist"
        // The clock form, not "21 min": the Setlists screen's row summary above
        // this card states the same total, and two roundings of one number side
        // by side read as two different numbers.
        action={
          <MonoPill>
            {view.songs.length} {view.songs.length === 1 ? "song" : "songs"}
            {view.totalSeconds == null ? "" : ` · ${formatDurationClock(view.totalSeconds)}`}
          </MonoPill>
        }
      />

      {view.songs.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: 13, padding: "10px 0 16px" }}>
          Nothing written yet. Add the songs in the order you plan to play them — the venue reads
          this set to report the performance to the collecting society.
        </div>
      ) : (
        <div style={{ marginTop: 4 }}>
          <div className={styles.head}>
            <span>#</span>
            <span>Title</span>
            <span>Length</span>
            <span />
          </div>
          {view.songs.map((song, index) => (
            <SongRow
              key={song.key}
              index={index}
              song={song}
              count={view.songs.length}
              view={view}
            />
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginTop: 14,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
        }}
      >
        <Button
          variant="secondary"
          leftIcon={<Icon name="plus" size={14} />}
          onClick={view.addSong}
        >
          Add song
        </Button>
        <div style={{ flex: 1 }} />
        {view.isDirty && (
          <Button variant="ghost" onClick={view.discard} disabled={view.isSaving}>
            Discard
          </Button>
        )}
        <Button variant="primary" onClick={view.save} disabled={!view.isDirty || view.isSaving}>
          {view.isSaving ? "Saving…" : view.isDirty ? "Save setlist" : "Saved"}
        </Button>
      </div>

      <div style={{ color: "var(--dim)", fontSize: 12, marginTop: 10 }}>
        Length as <span style={{ fontFamily: "var(--font-mono)" }}>3:45</span>, or a plain number of
        minutes. Leave it empty if you don't know it — an empty length is recorded as unknown, never
        as zero.
      </div>

      {view.saveError != null && (
        <div style={{ marginTop: 12 }}>
          <ErrorState error={view.saveError} title="Couldn't save the setlist" />
        </div>
      )}
    </SectionCard>
  );
}

/** Somebody else's set, read-only, in playing order. */
function OtherSetlist({ setlist }: { setlist: SetlistRow }) {
  const works = parseSetlistWorks(Array.isArray(setlist.items) ? setlist.items : []);
  return (
    <SectionCard>
      <CardHeader
        icon={<Icon name="music" size={16} />}
        title={setlist.performerName ?? "Setlist"}
        action={
          <MonoPill>
            {works.length} {works.length === 1 ? "song" : "songs"}
          </MonoPill>
        }
      />
      {works.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Nothing written yet.</div>
      ) : (
        <ol
          style={{
            listStyle: "decimal",
            margin: 0,
            paddingLeft: 22,
            color: "var(--dim)",
            fontSize: 13,
            lineHeight: 1.95,
          }}
        >
          {works.map((work) => (
            <li key={`${work.position}-${work.title}`}>
              <span style={{ color: "var(--text)" }}>{work.title}</span>
              {work.durationSeconds != null && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                  {" · "}
                  {formatDurationClock(work.durationSeconds)}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

export interface SetlistEditorProps {
  view: EventSetlistView;
}

export function SetlistEditor({ view }: SetlistEditorProps) {
  if (view.isPending) return <LoadingState label="Loading setlist" />;
  if (view.isError) return <ErrorState error={view.error} title="Couldn't load the setlist" />;

  if (!view.canAuthor && view.otherSetlists.length === 0) {
    // Two different empties, and saying the wrong one is a lie either way. The
    // operator running the night is served EVERY act's set, so nothing here
    // means nobody has written one; anyone else is served only what was shared
    // with them, so nothing here means nothing was.
    return (
      <EmptyState
        icon={<Icon name="music" />}
        title={view.canReadEveryAct ? "No setlists yet" : "No setlist to show"}
        description={
          view.canReadEveryAct
            ? "The acts on this bill write their own setlists. Each one appears here as soon as it is written, and the performed-works report is built from all of them."
            : "The act writes the setlist for a show. You'll see one here only if the performer shares it with you."
        }
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {view.canAuthor && <OwnSetlist view={view} />}
      {view.otherSetlists.map((setlist) => (
        <OtherSetlist key={setlist.id} setlist={setlist} />
      ))}
    </div>
  );
}
