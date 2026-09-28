import { useGetApiV1Profiles, useGetApiV1ProfilesSearch } from "@showme/api-client";
import { Icon } from "@showme/design-system";
import { useRef } from "react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { fieldStyle } from "./eventUi";
import { usePickerPopover } from "./usePickerPopover";

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
  /**
   * The venue's ISO country, when the source knows it (QA sweep run 7, QA7-5).
   *
   * Carried because **currency is a per-country fact** (decisions.md #17) and a caller
   * that needs the venue's currency has no other way to get it: a performer or an agent
   * gets a **404** on `GET /profiles/:id` for a venue they are not a member of, so the
   * search result the picker already holds is the only place this is available to them.
   *
   * Null on the caller's OWN profiles branch, which reads `GET /profiles` — that list
   * carries `location` rather than a flat country, and the one caller that needs the
   * country is picking somebody else's venue.
   */
  country?: string | null;
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
  /**
   * THE INNERMOST DISMISSIBLE THING TAKES THE ESCAPE (QA sweep run 3, r3:731).
   *
   * This field held the app's last click-catcher overlay — a `position: fixed;
   * inset: 0` button over the whole viewport — and no Escape handler at all. Both
   * halves were measured while creating an event: the panel opened over the wizard's
   * **Continue** button and ate the click on it (the overlay was the thing being
   * clicked), and Escape went straight past the panel to the wizard, which offered
   * *"Leave without creating this event? Everything you have filled in will be lost"*
   * over a form holding an artist, a venue, a city, a date and a capacity — with the
   * panel still open behind the warning.
   *
   * `usePickerPopover` is where both rules already live, and its own comment names
   * this exact hazard: *"no click-catcher overlay: one would swallow the first click
   * on the modal behind it"*. Escape is caught in the CAPTURE phase, which is what
   * makes it close this panel and not the modal around it. Only the panel is drawn
   * here; the hook owns when it is open.
   */
  const inputRef = useRef<HTMLInputElement>(null);
  const { wrapperRef, open, openPopover, closePopover } = usePickerPopover({ inputRef });
  const term = useDebouncedValue(value.trim(), 250);

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
      country: profile.location?.country ?? null,
    }));
  const mineIds = new Set(mine.map((entry) => entry.profileId));
  const found = (search.data?.items ?? [])
    .filter((profile) => !mineIds.has(profile.id))
    .map((profile) => ({
      profileId: profile.id,
      name: profile.name,
      city: profile.city,
      country: profile.country,
    }));

  const choose = (choice: VenueChoice) => {
    // Picking a venue IS the operator naming it, so the name follows the choice.
    // Everything the venue knows ABOUT itself is only ever offered into blanks.
    onChangeText(choice.name);
    onSelectProfile(choice);
    closePopover(false);
  };

  // Two states, and they now LOOK different (ClickUp 86cbaxyjy). A picked venue
  // is a committed chip; free text is a text field. The field used to be one
  // control in both cases, so typing over a chosen venue silently unlinked the
  // profile while everything that profile had lent the event — its city, its
  // capacity — stayed behind under a different room's name. A capacity is not a
  // decoration: it caps the ticket inventory and draws the break-even line.
  //
  // Unlinking is therefore an ACT: the operator takes the chip off, and the
  // caller (which is the only side that knows what it filled in from the
  // profile) drops what came with it.
  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      {selectedProfileId ? (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            ...fieldStyle,
            padding: "9px 12px",
            ...inputStyle,
          }}
        >
          <Icon name="building" size={15} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: "var(--text)" }}>{value}</span>
          <button
            type="button"
            aria-label={`Unlink ${value || "venue profile"}`}
            onClick={() => onSelectProfile(null)}
            style={{
              display: "grid",
              placeItems: "center",
              width: 22,
              height: 22,
              borderRadius: 7,
              border: "1px solid var(--border)",
              background: "var(--button-surface)",
              color: "var(--muted)",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <Icon name="x" size={13} />
          </button>
        </span>
      ) : (
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
          <Icon name="search" size={15} />
          <input
            id={inputId}
            aria-label={inputAriaLabel}
            value={value}
            ref={inputRef}
            onFocus={() => openPopover(false)}
            onChange={(changeEvent) => {
              onChangeText(changeEvent.target.value);
              openPopover(false);
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
      )}

      {open && !selectedProfileId && (
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
