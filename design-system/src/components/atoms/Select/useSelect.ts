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
const SEARCH_ROW_HEIGHT = 45;

export interface UseSelectOptions {
  items: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  searchable: boolean;
  listId: string;
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
}: UseSelectOptions) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () => (searchable ? items.filter((item) => matches(item, query)) : items),
    [items, query, searchable],
  );

  const selected = items.find((item) => item.value === value) ?? null;
  const filteredSelectedIndex = filtered.findIndex((item) => item.value === value);

  const updatePosition = useCallback(() => {
    const element = triggerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const listHeight = Math.max(filtered.length, 1) * OPTION_HEIGHT + 12;
    const estimated = Math.min(listHeight + (searchable ? SEARCH_ROW_HEIGHT : 0), 320);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < estimated && rect.top > spaceBelow;
    setMenuStyle({
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(160, (openUp ? rect.top : spaceBelow) - 12),
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    });
  }, [filtered.length, searchable]);

  const close = useCallback((focusTrigger = true) => {
    setOpen(false);
    setQuery("");
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const openWith = useCallback((seedQuery = "") => {
    setQuery(seedQuery);
    setOpen(true);
  }, []);

  // Open housekeeping: position the popover and keep it glued to its trigger.
  useEffect(() => {
    if (!open) return;
    updatePosition();

    const onScrollOrResize = () => updatePosition();
    const onPointerDown = (pointerEvent: PointerEvent) => {
      const target = pointerEvent.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
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

  // Focus moves into the search box only once the popover is actually mounted,
  // which is one render after `open` flips — the panel waits for a measured
  // position before it exists.
  const positioned = menuStyle !== null;
  useEffect(() => {
    if (open && searchable && positioned) searchRef.current?.focus();
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
      close();
    },
    [filtered, onChange, close],
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
        // Focus lives inside a portal, so the browser's own Tab order would
        // jump to the end of the document. Close and hand focus back instead.
        case "Tab":
          keyEvent.preventDefault();
          close();
          return true;
        default:
          return false;
      }
    },
    [step, commit, activeIndex, close],
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
    commit,
    close,
    toggle: () => (open ? close() : openWith()),
    onTriggerKeyDown,
    onSearchKeyDown,
  };
}
