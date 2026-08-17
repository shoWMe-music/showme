import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/icons";
import { classNames } from "@/lib/classNames";
import styles from "./Select.module.css";

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  /** Mono uppercase label above the control (matches TextField). */
  label?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** Plain strings (value === label) or `{ value, label }` objects. */
  options: Array<SelectOption | string>;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}

function normalize(option: SelectOption | string): SelectOption {
  return typeof option === "string" ? { value: option, label: option } : option;
}

/**
 * The app's dropdown. Unlike a native `<select>` — whose open list is drawn by
 * the OS and can't be themed — this is a fully styled listbox: a trigger that
 * matches TextField and a portalled popup with hover/selected/keyboard states.
 *
 * Accessibility: the trigger owns focus and drives the list via
 * `aria-activedescendant` (WAI-ARIA combobox pattern). Arrow keys move the
 * active option, Enter/Space selects, Escape closes, Home/End jump, typing is
 * not captured. Respects prefers-reduced-motion.
 */
export function Select({
  label,
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  id,
  className,
  "aria-label": ariaLabel,
}: SelectProps) {
  const items = useMemo(() => options.map(normalize), [options]);
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const listId = `${triggerId}-list`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedIndex = items.findIndex((item) => item.value === value);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null;

  const updatePosition = useCallback(() => {
    const element = triggerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const estimated = Math.min(items.length * 36 + 12, 288);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < estimated && rect.top > spaceBelow;
    setMenuStyle({
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(140, (openUp ? rect.top : spaceBelow) - 12),
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    });
  }, [items.length]);

  // Open/close housekeeping: seed the active option, position, and wire up the
  // listeners that keep the popup glued to the trigger and dismiss it.
  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    updatePosition();

    const onScrollOrResize = () => updatePosition();
    const onPointerDown = (pointerEvent: PointerEvent) => {
      const target = pointerEvent.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("pointerdown", onPointerDown);
    };
    // selectedIndex intentionally omitted — only re-run on open toggle.
    // biome-ignore lint/correctness/useExhaustiveDependencies: run on open only.
  }, [open, updatePosition]);

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current
      ?.querySelector(`#${CSS.escape(`${listId}-opt-${activeIndex}`)}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, listId]);

  const close = useCallback((focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const commit = useCallback(
    (index: number) => {
      const option = items[index];
      if (!option || option.disabled) return;
      onChange(option.value);
      close();
    },
    [items, onChange, close],
  );

  const step = useCallback(
    (from: number, direction: 1 | -1) => {
      const count = items.length;
      for (let offset = 1; offset <= count; offset++) {
        const next = (from + direction * offset + count * offset) % count;
        if (!items[next]?.disabled) return next;
      }
      return from;
    },
    [items],
  );

  function onKeyDown(keyEvent: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(keyEvent.key)) {
        keyEvent.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (keyEvent.key) {
      case "ArrowDown":
        keyEvent.preventDefault();
        setActiveIndex((current) => step(current < 0 ? -1 : current, 1));
        break;
      case "ArrowUp":
        keyEvent.preventDefault();
        setActiveIndex((current) => step(current < 0 ? 0 : current, -1));
        break;
      case "Home":
        keyEvent.preventDefault();
        setActiveIndex(step(-1, 1));
        break;
      case "End":
        keyEvent.preventDefault();
        setActiveIndex(step(0, -1));
        break;
      case "Enter":
      case " ":
        keyEvent.preventDefault();
        commit(activeIndex);
        break;
      case "Escape":
        keyEvent.preventDefault();
        close();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div className={classNames(styles.field, className)}>
      {label && (
        <label htmlFor={triggerId} className={styles.label}>
          {label}
        </label>
      )}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        className={styles.trigger}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? styles.value : styles.placeholder}>
          {selected ? selected.label : placeholder}
        </span>
        <Icon
          name="chevron-down"
          size={16}
          className={classNames(styles.chevron, open && styles.chevronOpen)}
        />
      </button>

      {open &&
        menuStyle &&
        createPortal(
          <div ref={listRef} id={listId} role="listbox" className={styles.panel} style={menuStyle}>
            {items.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <div
                  key={option.value}
                  id={`${listId}-opt-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  className={classNames(
                    styles.option,
                    index === activeIndex && styles.optionActive,
                    option.disabled && styles.optionDisabled,
                  )}
                  onPointerDown={(pointerEvent) => pointerEvent.preventDefault()}
                  onClick={() => commit(index)}
                  onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                >
                  <span className={styles.optionLabel}>{option.label}</span>
                  {isSelected && <Icon name="check" size={15} className={styles.check} />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
