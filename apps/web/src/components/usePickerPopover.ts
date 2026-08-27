import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export interface PickerPopoverOptions {
  /**
   * The control the panel hangs off. `HTMLElement`, not `HTMLInputElement`: all
   * this hook ever asks of it is `getBoundingClientRect()` and `focus()`, and
   * three callers anchor a BUTTON rather than a field (`EventRowMenu`,
   * `useCalendarEntryPreview`, `CalendarJumpToDate`). Typing it to the narrowest
   * caller made each of them cast through `unknown` to say something true.
   */
  inputRef: RefObject<HTMLElement | null>;
}

/**
 * The shell every in-app field picker shares: open/close, where the panel hangs,
 * and the three ways it goes away again (Escape, a click outside, focus leaving).
 * It knows nothing about days or clocks — `useDatePickerPopover` layers the
 * calendar on top, `TimePickerField` uses it bare.
 */
export function usePickerPopover({ inputRef }: PickerPopoverOptions) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDialogElement>(null);

  const [open, setOpen] = useState(false);
  // Whether the panel (rather than the text field) currently holds the
  // keyboard: only then does it pull DOM focus onto its own controls.
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const measureAnchor = useCallback(() => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (rect) setAnchorRect(rect);
  }, [inputRef]);

  const openPopover = useCallback(
    (withKeyboard: boolean) => {
      measureAnchor();
      setKeyboardActive(withKeyboard);
      setOpen(true);
    },
    [measureAnchor],
  );

  const closePopover = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      setKeyboardActive(false);
      if (returnFocus) inputRef.current?.focus();
    },
    [inputRef],
  );

  const togglePopover = useCallback(
    (withKeyboard: boolean) => {
      if (open) closePopover(true);
      else openPopover(withKeyboard);
    },
    [open, openPopover, closePopover],
  );

  // Escape must close the POPOVER only. The design-system Modal listens for
  // Escape on `document` in the bubble phase, so a document-level CAPTURE
  // listener here runs first and stops the event before the modal ever sees it —
  // one Escape closes the picker, the next closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKeyDownCapture = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closePopover(true);
    };
    document.addEventListener("keydown", onKeyDownCapture, true);
    return () => document.removeEventListener("keydown", onKeyDownCapture, true);
  }, [open, closePopover]);

  // Dismiss when the pointer or the focus lands anywhere outside the field and
  // its panel (no click-catcher overlay: one would swallow the first click on
  // the modal behind it, and as a <button> it would sit in the tab order).
  useEffect(() => {
    if (!open) return;
    const isOutside = (target: EventTarget | null) => {
      const node = target instanceof Node ? target : null;
      if (!node) return true;
      return !wrapperRef.current?.contains(node) && !panelRef.current?.contains(node);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (isOutside(event.target)) closePopover(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (isOutside(event.target)) closePopover(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open, closePopover]);

  // The field moves with the modal body's scroll, so re-measure rather than let
  // the panel drift away from it.
  useEffect(() => {
    if (!open) return;
    const onViewportChange = () => measureAnchor();
    window.addEventListener("resize", onViewportChange);
    document.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      document.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, measureAnchor]);

  /** Alt+ArrowDown is the standard "open the picker" chord — and in Chrome it is
   * one of the gestures that would otherwise summon the NATIVE popup. */
  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        openPopover(true);
      }
    },
    [openPopover],
  );

  return {
    wrapperRef,
    panelRef,
    open,
    anchorRect,
    keyboardActive,
    setKeyboardActive,
    openPopover,
    closePopover,
    togglePopover,
    handleInputKeyDown,
  };
}
