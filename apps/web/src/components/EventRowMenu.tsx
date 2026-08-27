import { Card, Icon } from "@showme/design-system";
import { type CSSProperties, useRef } from "react";
import { PickerPopoverPanel } from "./PickerPopoverPanel";
import { usePickerPopover } from "./usePickerPopover";

/**
 * The overflow ("⋮") menu on one event, wherever an event is drawn as a row, a
 * card or a chip — the events list, the board, the calendar's entry preview.
 *
 * Presentational: it owns opening, positioning and dismissal, and nothing else.
 * The screen decides what the menu offers and what each entry does.
 *
 * Two pieces of the app it deliberately reuses rather than re-inventing:
 *
 *  - **`usePickerPopover` + `PickerPopoverPanel`** — the app's one popover shell.
 *    Portalled to `<body>`, dismissed by an outside click, focus leaving, or a
 *    capture-phase Escape that closes the menu WITHOUT closing a modal behind it.
 *    Portalling is what lets a row menu exist at all: the events list card is
 *    `overflow: hidden` (it clips its rows to the rounded corners), so a panel
 *    positioned inside a row would be cut off at the card's edge. The one place
 *    that does NOT portal is `nested` — see the prop, and the trap it avoids.
 *  - **The refusal shape from the Team screen's member menu** — an entry is either
 *    live or it says WHY it is not. A disabled item with no reason reads as a
 *    broken one.
 */

/** One entry. Live if it has an `onSelect`; otherwise refused, with a reason. */
export interface EventMenuItem {
  key: string;
  label: string;
  onSelect?: () => void;
  /** Why this action is not on offer. Rendered as the entry's help text. */
  refusal?: string;
  /**
   * What the action actually does, for a verb whose consequence is not obvious
   * from its name. "Archive" is exactly that verb: it reads as "delete" to plenty
   * of people, and this one deletes nothing and is invisible to everyone else.
   */
  hint?: string;
}

export interface EventRowMenuProps {
  items: EventMenuItem[];
  /** Names the trigger for assistive tech — include the event, since a list of
   * rows would otherwise offer a dozen buttons all called "Event menu". */
  label: string;
  /**
   * Hang the panel off the trigger IN PLACE instead of portalling it to `<body>`.
   *
   * For a menu that lives INSIDE another popover — the calendar's entry preview.
   * A portalled panel there is a trap: the preview dismisses on any pointerdown
   * outside its own DOM, a portal to `<body>` is outside it, so mousedown on a
   * menu entry would unmount the entry before its click could land. Kept inside,
   * the entries are part of the preview and the preview never sees them leave.
   *
   * Still absolutely positioned, so opening the menu cannot reflow the panel it
   * is sitting in — the first cut let the entries take part in the header's flex
   * row, which squeezed the event's title to nothing and printed the two on top
   * of each other.
   */
  nested?: boolean;
}

const PANEL_WIDTH = 248;
/** Roughly how tall the panel will be. Only chooses up-or-down, so an estimate is
 * enough — a refused entry wraps its reason under the label and runs about twice
 * the height of a plain one (the same measure the Team screen's menu uses). */
function estimatedHeight(items: EventMenuItem[]): number {
  return items.reduce((total, item) => total + ((item.refusal ?? item.hint) ? 64 : 34), 10);
}

export function EventRowMenu({ items, label, nested = false }: EventRowMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popover = usePickerPopover({
    inputRef: triggerRef,
  });

  const entries = items.map((item) => (
    <button
      key={item.key}
      type="button"
      role="menuitem"
      disabled={!item.onSelect}
      onClick={(clickEvent) => {
        // React portals bubble through the REACT tree, not the DOM one: without
        // this, a click on an entry inside the calendar's portalled entry preview
        // travels up to the day cell behind it and opens its "create" menu on top
        // of the toast. The chip's own button stops propagation for the same
        // reason.
        clickEvent.stopPropagation();
        popover.closePopover(true);
        item.onSelect?.();
      }}
      style={itemStyle(!item.onSelect)}
      onMouseEnter={(mouseEvent) => {
        if (item.onSelect) mouseEvent.currentTarget.style.background = "var(--shape-fill)";
      }}
      onMouseLeave={(mouseEvent) => {
        mouseEvent.currentTarget.style.background = "transparent";
      }}
    >
      <span>{item.label}</span>
      {/* The reason travels WITH the refused entry: a title attribute alone is
          invisible to anyone who does not hover it, which is how a disabled item
          comes to read as a broken one. A live entry's hint sits in the same
          place, for the same reason. */}
      {(item.refusal ?? item.hint) && <span style={subtextStyle}>{item.refusal ?? item.hint}</span>}
    </button>
  ));

  return (
    <span
      ref={popover.wrapperRef}
      style={{ display: "inline-flex", position: nested ? "relative" : undefined }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={popover.open}
        onClick={(clickEvent) => {
          // The row behind the trigger navigates into the event on click.
          clickEvent.stopPropagation();
          popover.togglePopover(false);
        }}
        style={triggerStyle}
      >
        <Icon name="dots-vertical" size={16} />
      </button>

      {popover.open &&
        (nested ? (
          <div role="menu" aria-label={label} style={nestedPanelStyle}>
            <Card padding="none" elevated style={{ padding: 5 }}>
              {entries}
            </Card>
          </div>
        ) : (
          popover.anchorRect && (
            <PickerPopoverPanel
              anchor={popover.anchorRect}
              panelRef={popover.panelRef}
              width={PANEL_WIDTH}
              estimatedHeight={estimatedHeight(items)}
              label={label}
              containTab
            >
              <Card padding="none" elevated style={{ padding: 5 }}>
                {entries}
              </Card>
            </PickerPopoverPanel>
          )
        ))}
    </span>
  );
}

/** The same 28px borderless trigger the Team screen's roster rows carry — a row
 * affordance, not a control with its own outline. */
const triggerStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
};

/** A live entry reads as text you may click; a refused one is visibly greyed and
 * wraps its reason underneath, so it never looks merely broken. */
function itemStyle(refused: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
    width: "100%",
    textAlign: "left",
    padding: "9px 11px",
    border: "none",
    borderRadius: 8,
    background: "transparent",
    color: refused ? "var(--dim)" : "var(--text)",
    fontSize: 13,
    cursor: refused ? "not-allowed" : "pointer",
    opacity: refused ? 0.65 : 1,
  };
}

/** The nested variant: the same card, hung off the trigger's own box rather than
 * the viewport. It sits ABOVE the surrounding panel's content (`zIndex`) and out
 * of its layout (`absolute`), so opening it moves nothing underneath. */
const nestedPanelStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  right: 0,
  zIndex: 20,
  width: PANEL_WIDTH,
};

/**
 * The click target a row needs once it carries a menu of its own: a real
 * <button> stretched across the row, so the row is one tab stop and one click
 * while the menu beside it stays a separate control.
 *
 * A row that IS a button cannot hold one — a button inside a button is invalid
 * HTML, and the browser's repair is to drop the inner one on the floor.
 * Positioned, so it paints above the row's text and catches the click;
 * transparent, so it shows none of that.
 */
export const rowClickTargetStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  padding: 0,
  border: 0,
  background: "transparent",
  cursor: "pointer",
};

const subtextStyle: CSSProperties = {
  color: "var(--dim)",
  fontSize: 11,
  lineHeight: 1.35,
  whiteSpace: "normal",
};
