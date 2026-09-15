import { useRef } from "react";
import { publicProfileUrl } from "../lib/publicSite";
import { PickerPopoverPanel } from "./PickerPopoverPanel";
import { usePickerPopover } from "./usePickerPopover";

/**
 * A NAME YOU CAN DO SOMETHING WITH (ClickUp `123qy9rnfab`).
 *
 * Ran asked for two menus and they are the same menu with a different number of
 * entries:
 *
 *   *"Clicking or hovering a venue name/profile should give you the options:
 *   show location on google maps / go to profile"*
 *   *"Clicking or hovering a performer/agent/promoter etc name/profile: go to
 *   profile"*
 *
 * ## CLICK, not hover
 *
 * The ticket says "clicking or hovering". This opens on click, and that is a
 * deliberate reading rather than half the work. A hover menu does not exist on a
 * touch screen — the first tap becomes the hover and the second activates
 * whatever is under the pointer by then — and on a desktop it fires while the
 * reader is on their way somewhere else, which is how a menu covers the row
 * below the one you were reading. Click is the interaction that behaves the same
 * on every device and is reachable from a keyboard, which a hover is not.
 *
 * ## It is a button, so it cannot go inside a row that is already a link
 *
 * The Events list makes each ROW a single stretched click target, and the code
 * there says why ("a link inside a link is not a thing"). So this belongs on the
 * surfaces where a name is a name — the event workspace's information card —
 * and not on a list row whose whole job is to open the event.
 *
 * Renders as plain text when there is nothing to offer: a profile with no slug
 * and no address has no menu behind it, and a control that opens an empty panel
 * is worse than no control.
 */
export interface ProfileNameMenuProps {
  name: string;
  /** The public profile's slug. Absent for an off-platform name. */
  slug?: string | null;
  /**
   * A street address to open in Google Maps. Venues only — Ran asked for the map
   * on the venue and not on the people, and a performer's address is not a place
   * anybody is being sent to.
   */
  mapQuery?: string | null;
  /** Rendered before the name (the venue's building glyph). */
  glyph?: React.ReactNode;
}

/**
 * Google Maps by SEARCH QUERY, not by coordinates.
 *
 * `profile_locations` carries `lat`/`lng` and they are tempting, but a pin
 * dropped at a stored coordinate is only as good as whatever geocoded it, and a
 * wrong pin sends somebody to the wrong building with no way to tell. A text
 * search puts Google's own matching in front of the answer and shows the venue's
 * card when it recognises the place, which is what a person wants from "show
 * this on a map".
 */
function mapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function ProfileNameMenu({ name, slug, mapQuery, glyph }: ProfileNameMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popover = usePickerPopover({ inputRef: triggerRef });

  const actions: { label: string; href: string }[] = [];
  if (slug) actions.push({ label: "Go to profile", href: publicProfileUrl(slug) });
  if (mapQuery?.trim()) {
    actions.push({ label: "Show location on Google Maps", href: mapsUrl(mapQuery.trim()) });
  }

  if (actions.length === 0) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {glyph}
        {name}
      </span>
    );
  }

  return (
    <span ref={popover.wrapperRef} style={{ display: "inline-flex", alignItems: "center" }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={popover.open}
        onClick={(clickEvent) => {
          // The card's rows are themselves buttons that begin an inline edit; a
          // click on the name is about the name, not about editing the field.
          clickEvent.stopPropagation();
          popover.togglePopover(false);
        }}
        // No key handler: a <button> already activates on Enter and Space, and the
        // hook closes on Escape from a document-level listener. `handleInputKeyDown`
        // is typed for the text fields it was written for.
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          border: 0,
          background: "transparent",
          padding: 0,
          font: "inherit",
          color: "inherit",
          cursor: "pointer",
          // Underlined on hover only: a permanent underline in a table of values
          // would read as a link on every row, and only some of them are.
          textDecoration: popover.open ? "underline" : "none",
          textUnderlineOffset: 3,
        }}
        onMouseEnter={(hover) => {
          hover.currentTarget.style.textDecoration = "underline";
        }}
        onMouseLeave={(hover) => {
          hover.currentTarget.style.textDecoration = popover.open ? "underline" : "none";
        }}
      >
        {glyph}
        {name}
      </button>

      {popover.open && popover.anchorRect && (
        <PickerPopoverPanel
          anchor={popover.anchorRect}
          panelRef={popover.panelRef}
          width={260}
          estimatedHeight={actions.length * 40 + 12}
          label={`${name} — actions`}
          containTab
          fieldTabStop={triggerRef}
        >
          {/* The panel itself is transparent by contract — every caller of
              `PickerPopoverPanel` brings its own card — so this is the same
              surface the calendar's create menu uses, from the same tokens. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              padding: 6,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              boxShadow: "var(--shadow-lg)",
            }}
          >
            {actions.map((action) => (
              <a
                key={action.label}
                href={action.href}
                // Both destinations leave the app — the public site and Google —
                // so neither should take the workspace's tab with it.
                target="_blank"
                rel="noreferrer noopener"
                onClick={() => popover.closePopover(false)}
                style={{
                  padding: "9px 10px",
                  borderRadius: 8,
                  fontSize: 13.5,
                  color: "var(--text)",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(hover) => {
                  hover.currentTarget.style.background = "var(--shape-fill)";
                }}
                onMouseLeave={(hover) => {
                  hover.currentTarget.style.background = "transparent";
                }}
              >
                {action.label}
              </a>
            ))}
          </div>
        </PickerPopoverPanel>
      )}
    </span>
  );
}
