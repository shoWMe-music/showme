import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface SelectOption {
  value: string;
  label: ReactNode;
  /** What choosing this option MEANS, on a second line under the label. For a
   * list where the words alone do not settle it — "Confirmed: the booking is on,
   * and this is the status that counts against your plan". */
  description?: ReactNode;
  disabled?: boolean;
  /** What the search box matches against when `label` is not plain text. */
  searchText?: string;
}

export function normalizeOption(option: SelectOption | string): SelectOption {
  return typeof option === "string" ? { value: option, label: option } : option;
}

/** The text a search query is matched against: the caller's `searchText`, else
 * a plain-text label, else the raw value — so a rich label never becomes
 * unsearchable. */
function optionSearchText(option: SelectOption): string {
  if (option.searchText != null) return option.searchText;
  if (typeof option.label === "string" || typeof option.label === "number") {
    return String(option.label);
  }
  return option.value;
}

function matches(option: SelectOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const haystack = `${optionSearchText(option)} ${option.value}`.toLowerCase();
  return haystack.includes(needle);
}

const OPTION_HEIGHT = 36;
/** An option that also explains itself is two lines rather than one. */
const OPTION_WITH_DESCRIPTION_HEIGHT = 58;
const SEARCH_ROW_HEIGHT = 45;
/** Stands in for the footer until it has been laid out once and can be measured. */
const FOOTER_ROW_HEIGHT = 58;

export interface UseSelectOptions {
  items: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  searchable: boolean;
  listId: string;
  /** Drive the menu from outside. Omit for the ordinary self-managing dropdown;
   * pass it (with `onOpenChange`) when something else decides when the menu is
   * up — a row that opens its picker the moment it is clicked, say. */
  open?: boolean;
  /** Every open and every close, however it happened: the trigger, Escape, a
   * click outside, a choice. The single place to learn the menu went away. */
  onOpenChange?: (open: boolean) => void;
  /** Whether choosing an option also closes the menu. False keeps it up so a
   * `footer` can confirm the choice — see `Select`. */
  closeOnSelect: boolean;
  /** Whether a footer is rendered, so Tab leads into it instead of closing and
   * the menu is measured tall enough to hold it. */
  hasFooter: boolean;
  /** A floor for the menu's width. Menus match their trigger by default, which
   * is right for a form control and wrong for a trigger sized to its own value
   * — an inline table row, an icon button — where matching it opens a column too
   * narrow to read. */
  menuWidth?: number;
}

/**
 * Open/close, filtering, active-option and positioning logic for `Select`.
 *
 * Keyboard model: one `navigate` handler serves both the collapsed trigger and
 * the popover's search box, so arrow keys / Enter / Home / End / Tab behave
 * identically whether or not the search box has focus. Escape is handled a
 * level up, in the capture phase on `document`, so an open popover wins it
 * over any dialog behind it.
 */
export function useSelect({
  items,
  value,
  onChange,
  disabled,
  searchable,
  listId,
  open: controlledOpen,
  onOpenChange,
  closeOnSelect,
  hasFooter,
  menuWidth,
}: UseSelectOptions) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  // Controlled when a caller passes `open`, self-managing otherwise. Both routes
  // announce every change, so a caller can drive the menu, only listen, or
  // neither, without the component behaving differently underneath.
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const filtered = useMemo(
    () => (searchable ? items.filter((item) => matches(item, query)) : items),
    [items, query, searchable],
  );

  const selected = items.find((item) => item.value === value) ?? null;
  const filteredSelectedIndex = filtered.findIndex((item) => item.value === value);

/** Breathing room between the trigger and its menu. */
const GAP = 4;
/** Never let the menu touch the edge of the window. */
const VIEWPORT_MARGIN = 8;
/** Below this a menu is not worth opening as a list — roughly five options. */
const MINIMUM_MENU_HEIGHT = 240;

  const updatePosition = useCallback(() => {
    const element = triggerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const rowHeight = items.some((item) => item.description != null)
      ? OPTION_WITH_DESCRIPTION_HEIGHT
      : OPTION_HEIGHT;
    const listHeight = Math.max(filtered.length, 1) * rowHeight + 12;
    // Measured once the footer has been laid out, estimated before that. Being a
    // few pixels out only nudges the open-up/open-down choice; the list scrolls
    // either way.
    const footerHeight = hasFooter ? (footerRef.current?.offsetHeight ?? FOOTER_ROW_HEIGHT) : 0;
    const wanted = listHeight + (searchable ? SEARCH_ROW_HEIGHT : 0) + footerHeight;

    // Open on whichever side has MORE ROOM, not merely when below is too small.
    // A control low in a card had plenty of space above it and was still opening
    // downward into a sliver, because "below is insufficient" was only half the
    // question — the other half is whether up is actually better.
    const spaceBelow = window.innerHeight - rect.bottom - GAP - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - GAP - VIEWPORT_MARGIN;
    const openUp = spaceAbove > spaceBelow && spaceBelow < wanted;
    const available = openUp ? spaceAbove : spaceBelow;

    // Never wider than it was asked to be, never off the edge of the window.
    const width = Math.max(rect.width, menuWidth ?? 0);
    setMenuStyle({
      left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN)),
      width,
      // Never taller than it needs, never shorter than the room allows. The old
      // floor of 160 was applied even when the viewport could not honour it, so
      // a menu near an edge both overflowed AND showed three options.
      maxHeight: Math.max(Math.min(wanted, available), Math.min(MINIMUM_MENU_HEIGHT, available)),
      ...(openUp ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
    });
  }, [filtered.length, items, searchable, hasFooter, menuWidth]);

  const close = useCallback(
    (focusTrigger = true) => {
      setOpen(false);
      setQuery("");
      if (focusTrigger) triggerRef.current?.focus();
    },
    [setOpen],
  );

  const openWith = useCallback(
    (seedQuery = "") => {
      setQuery(seedQuery);
      setOpen(true);
    },
    [setOpen],
  );

  // Open housekeeping: position the popover and keep it glued to its trigger.
  useEffect(() => {
    if (!open) return;
    updatePosition();

    const onScrollOrResize = () => updatePosition();
    const onPointerDown = (pointerEvent: PointerEvent) => {
      const target = pointerEvent.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close(false);
    };
    // Escape belongs to the topmost layer, and while this popover is open that
    // is the popover — not the Modal behind it, which also listens for Escape
    // on `document`. Claiming it in the capture phase settles the argument
    // before anything in the bubble phase is asked.
    const onEscapeCapture = (keyboardEvent: globalThis.KeyboardEvent) => {
      if (keyboardEvent.key !== "Escape") return;
      keyboardEvent.preventDefault();
      keyboardEvent.stopPropagation();
      close();
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscapeCapture, true);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscapeCapture, true);
    };
  }, [open, updatePosition, close]);

  // Focus moves into the popover only once it is actually mounted, which is one
  // render after `open` flips — the panel waits for a measured position before it
  // exists.
  //
  // Without a search box the TRIGGER is the combobox, and it has to hold the
  // keyboard for arrows and Enter to reach the list. That used to be assumed
  // rather than done, because the only way to open a menu was to click its
  // trigger, which focuses it for free. A caller driving `open` breaks that
  // assumption: the menu appears with the keyboard nowhere, and arrows do
  // nothing. Claim it — and only when it is not already inside, so a click never
  // has its focus taken off it and put back.
  const positioned = menuStyle !== null;
  useEffect(() => {
    if (!open || !positioned) return;
    if (searchable) {
      searchRef.current?.focus();
      return;
    }
    const trigger = triggerRef.current;
    if (trigger && !trigger.contains(document.activeElement)) trigger.focus();
  }, [open, searchable, positioned]);

  // Seeding the active option: with no query it is the current selection, and
  // once the user has typed it is the first match — so Enter always picks the
  // row the popover is highlighting. A narrowed list is also a shorter
  // popover, hence the reposition.
  useEffect(() => {
    if (!open) return;
    const firstEnabled = filtered.findIndex((option) => !option.disabled);
    const preferSelection = query.trim() === "" && filteredSelectedIndex >= 0;
    setActiveIndex(preferSelection ? filteredSelectedIndex : firstEnabled);
    updatePosition();
  }, [open, query, filtered, filteredSelectedIndex, updatePosition]);

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current
      ?.querySelector(`#${CSS.escape(`${listId}-opt-${activeIndex}`)}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, listId]);

  const commit = useCallback(
    (index: number) => {
      const option = filtered[index];
      if (!option || option.disabled) return;
      onChange(option.value);
      // With a footer the choice is a DRAFT — the menu stays up until the footer
      // says what to do with it.
      if (closeOnSelect) close();
    },
    [filtered, onChange, close, closeOnSelect],
  );

  /** The menu's own tab stops, in DOM order. `tabIndex >= 0` is what makes this
   * work beside the roving listbox: an option is a `role="option"` div, never a
   * stop, so this is the search box and whatever the footer holds. */
  const panelStops = useCallback(
    () =>
      [...(panelRef.current?.querySelectorAll<HTMLElement>("button, input, [tabindex]") ?? [])].filter(
        (element) => element.tabIndex >= 0 && !element.hasAttribute("disabled"),
      ),
    [],
  );

  const step = useCallback(
    (from: number, direction: 1 | -1) => {
      const count = filtered.length;
      if (count === 0) return -1;
      for (let offset = 1; offset <= count; offset++) {
        const next = (from + direction * offset + count * offset) % count;
        if (!filtered[next]?.disabled) return next;
      }
      return from;
    },
    [filtered],
  );

  /** Shared by the trigger and the search box. Returns true if it handled the
   * key, so callers can fall through to their own behaviour otherwise. */
  const navigate = useCallback(
    (keyEvent: KeyboardEvent<HTMLElement>): boolean => {
      switch (keyEvent.key) {
        case "ArrowDown":
          keyEvent.preventDefault();
          setActiveIndex((current) => step(current < 0 ? -1 : current, 1));
          return true;
        case "ArrowUp":
          keyEvent.preventDefault();
          setActiveIndex((current) => step(current < 0 ? 0 : current, -1));
          return true;
        case "Home":
          keyEvent.preventDefault();
          setActiveIndex(step(-1, 1));
          return true;
        case "End":
          keyEvent.preventDefault();
          setActiveIndex(step(0, -1));
          return true;
        case "Enter":
          keyEvent.preventDefault();
          commit(activeIndex);
          return true;
        // Escape is deliberately absent: it is claimed in the capture phase on
        // `document` while the popover is open, so it never reaches here.
        // Focus lives inside a portal, so the browser's own Tab order would jump
        // to the end of the document rather than into the menu hanging off this
        // control. Close and hand focus back — or, when there is a footer, step
        // into it, which is the only way to reach a Save button that lives in a
        // portal. `onPanelKeyDown` closes the loop from the other end.
        case "Tab": {
          keyEvent.preventDefault();
          if (!hasFooter) {
            close();
            return true;
          }
          const stops = panelStops();
          (keyEvent.shiftKey ? stops.at(-1) : stops.at(0))?.focus();
          return true;
        }
        default:
          return false;
      }
    },
    [step, commit, activeIndex, close, hasFooter, panelStops],
  );

  const onTriggerKeyDown = useCallback(
    (keyEvent: KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      if (open) {
        // With the search box focused the trigger never sees these; this path
        // is the `searchable={false}` control.
        navigate(keyEvent);
        return;
      }
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(keyEvent.key)) {
        keyEvent.preventDefault();
        openWith();
        return;
      }
      // Typing a printable character opens the popover and seeds the search,
      // the way a native <select> jumps to a matching option.
      if (searchable && keyEvent.key.length === 1 && !keyEvent.metaKey && !keyEvent.ctrlKey) {
        keyEvent.preventDefault();
        openWith(keyEvent.key);
      }
    },
    [disabled, open, navigate, openWith, searchable],
  );

  const onSearchKeyDown = useCallback(
    (keyEvent: KeyboardEvent<HTMLInputElement>) => {
      navigate(keyEvent);
    },
    [navigate],
  );

  /**
   * Tab off either end of the footer goes back to the control the menu belongs
   * to, making one small predictable loop: trigger → footer → trigger.
   *
   * The menu is portalled to the end of `<body>`, so without this a Tab off the
   * last button lands at the bottom of the document, nowhere near the control —
   * and the menu stays open behind it, with the keyboard somewhere else.
   */
  const onPanelKeyDown = useCallback(
    (keyEvent: KeyboardEvent<HTMLDivElement>) => {
      if (!hasFooter || keyEvent.key !== "Tab") return;
      const stops = panelStops();
      const atEnd = document.activeElement === (keyEvent.shiftKey ? stops.at(0) : stops.at(-1));
      if (!atEnd) return;
      keyEvent.preventDefault();
      triggerRef.current?.focus();
    },
    [hasFooter, panelStops],
  );

  return {
    open,
    query,
    setQuery,
    filtered,
    selected,
    activeIndex,
    setActiveIndex,
    menuStyle,
    triggerRef,
    panelRef,
    listRef,
    searchRef,
    footerRef,
    commit,
    close,
    toggle: () => (open ? close() : openWith()),
    onTriggerKeyDown,
    onSearchKeyDown,
    onPanelKeyDown,
  };
}
