import { useGetApiV1Profiles, useGetApiV1ProfilesSearch } from "@showme/api-client";
import { Icon } from "@showme/design-system";
import { useEffect, useState } from "react";
import { fieldStyle } from "./eventUi";

/**
 * The event's Venue field — a name you can type, or a venue PROFILE you can pick.
 *
 * It replaces a bare text input. Typing a venue's name is still allowed and still
 * works (plenty of rooms are not on shoWMe, and a booking must never wait for
 * one to sign up), but a room that IS on the platform has already written down
 * its capacity, its house curfew, its amenities and the city it stands in.
 * Choosing it rather than re-typing it is what lets all of that travel onto the
 * event — see `useEventVenuePrefill` for the client half and
 * `apps/api/src/routes/events.ts` for the server backstop.
 *
 * Two sources, in the order they are useful: the operator's OWN profiles first
 * (a venue running its own room picks itself, and that is the commonest case by
 * far), then every public operator profile that matches what they typed.
 */
export interface VenueChoice {
  profileId: string;
  name: string;
  city: string | null;
}

export interface EventVenuePickerProps {
  /** The venue name as it will be saved — free text, always the user's to edit. */
  value: string;
  onChangeText: (value: string) => void;
  /** A profile was chosen; `null` when the operator goes back to plain text. */
  onSelectProfile: (choice: VenueChoice | null) => void;
  /** The profile currently linked, so the field can say so. */
  selectedProfileId: string | null;
  placeholder?: string;
  inputStyle?: React.CSSProperties;
  /** Wired to a `<label htmlFor=…>` by the caller — the input is nested inside a
   * component, so a wrapping label can no longer reach it. */
  inputId?: string;
  /** Names the input where there is no room for a visible label — the event
   * card edits this field inside a row that already carries the word "Venue",
   * and a second copy of it above the control would be noise on screen and a
   * stutter in a screen reader. */
  inputAriaLabel?: string;
}

function useDebounced(value: string, delayMilliseconds: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMilliseconds);
    return () => clearTimeout(handle);
  }, [value, delayMilliseconds]);
  return debounced;
}

export function EventVenuePicker({
  value,
  onChangeText,
  onSelectProfile,
  selectedProfileId,
  placeholder = "e.g. Funkhaus",
  inputStyle,
  inputId,
  inputAriaLabel,
}: EventVenuePickerProps) {
  const [open, setOpen] = useState(false);
  const term = useDebounced(value.trim(), 250);

  const myProfiles = useGetApiV1Profiles({ query: { enabled: open } });
  const search = useGetApiV1ProfilesSearch(
    { q: term || undefined, kind: "operator", limit: 8 },
    { query: { enabled: open } },
  );

  const needle = term.toLowerCase();
  const mine = (myProfiles.data ?? [])
    .filter((profile) => profile.kind === "operator")
    .filter((profile) => !needle || profile.name.toLowerCase().includes(needle))
    .map((profile) => ({
      profileId: profile.id,
      name: profile.name,
      city: profile.location?.city ?? null,
    }));
  const mineIds = new Set(mine.map((entry) => entry.profileId));
  const found = (search.data?.items ?? [])
    .filter((profile) => !mineIds.has(profile.id))
    .map((profile) => ({ profileId: profile.id, name: profile.name, city: profile.city }));

  const choose = (choice: VenueChoice) => {
    // Picking a venue IS the operator naming it, so the name follows the choice.
    // Everything the venue knows ABOUT itself is only ever offered into blanks.
    onChangeText(choice.name);
    onSelectProfile(choice);
    setOpen(false);
  };

  return (
    <div style={{ position: "relative" }}>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          ...fieldStyle,
          // `inputStyle` LAST, so a caller can actually change the shell — the
          // padding used to be re-applied after it, which silently pinned this
          // field to 9px while the field beside it in the create-event wizard
          // took the 11px it asked for, and left the event card no way to size
          // the control down to a table row.
          padding: "9px 12px",
          ...inputStyle,
        }}
      >
        {selectedProfileId ? <Icon name="building" size={15} /> : <Icon name="search" size={15} />}
        <input
          id={inputId}
          aria-label={inputAriaLabel}
          value={value}
          onFocus={() => setOpen(true)}
          onChange={(changeEvent) => {
            onChangeText(changeEvent.target.value);
            // Typing over a chosen venue unlinks it — the name and the profile
            // must never disagree about which room this is.
            if (selectedProfileId) onSelectProfile(null);
            setOpen(true);
          }}
          placeholder={placeholder}
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            background: "transparent",
            color: "var(--text)",
            fontSize: 14,
            outline: "none",
          }}
        />
      </span>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close venue search"
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 40,
              border: 0,
              background: "transparent",
              cursor: "default",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              right: 0,
              zIndex: 41,
              maxHeight: 280,
              overflowY: "auto",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "var(--shadow-lg)",
              padding: 6,
            }}
          >
            {mine.length > 0 && <GroupHeader>My places</GroupHeader>}
            {mine.map((choice) => (
              <VenueRow key={choice.profileId} choice={choice} onClick={() => choose(choice)} />
            ))}
            {found.length > 0 && <GroupHeader>On shoWMe</GroupHeader>}
            {found.map((choice) => (
              <VenueRow key={choice.profileId} choice={choice} onClick={() => choose(choice)} />
            ))}
            {mine.length === 0 && found.length === 0 && (
              <div style={{ padding: "10px 12px", color: "var(--muted)", fontSize: 12.5 }}>
                No venue profile matches. Keep typing — a name on its own is fine.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "8px 10px 4px",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: ".1em",
        textTransform: "uppercase",
        color: "var(--dim)",
      }}
    >
      {children}
    </div>
  );
}

function VenueRow({ choice, onClick }: { choice: VenueChoice; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        width: "100%",
        textAlign: "left",
        padding: "9px 10px",
        borderRadius: 9,
        border: 0,
        background: "transparent",
        color: "var(--text)",
        fontSize: 13.5,
        cursor: "pointer",
      }}
    >
      <span style={{ fontWeight: 500 }}>{choice.name}</span>
      {choice.city && <span style={{ color: "var(--muted)", fontSize: 12 }}>{choice.city}</span>}
    </button>
  );
}
