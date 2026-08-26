import { Icon } from "@/icons";
import { classNames } from "@/lib/classNames";
import { type ReactNode, useId, useMemo } from "react";
import { createPortal } from "react-dom";
import styles from "./Select.module.css";
import { type SelectOption, normalizeOption, useSelect } from "./useSelect";

export type { SelectOption } from "./useSelect";

export interface SelectProps {
  /** Mono uppercase label above the control (matches TextField). */
  label?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** Plain strings (value === label) or `{ value, label }` objects. */
  options: Array<SelectOption | string>;
  placeholder?: string;
  disabled?: boolean;
  /** Type-to-filter search box in the popover. On by default; pass `false`
   * only for a genuinely tiny, fixed choice where a search box is noise. */
  searchable?: boolean;
  /** Placeholder for the search box. Defaults to "Search…". */
  searchPlaceholder?: string;
  /** Shown in place of the list when nothing matches. */
  noResultsLabel?: string;
  id?: string;
  className?: string;
  "aria-label"?: string;
}

/**
 * The app's dropdown. Unlike a native `<select>` — whose open list is drawn by
 * the OS and can't be themed — this is a fully styled listbox: a trigger that
 * matches TextField and a portalled popover with a search box, hover/selected
 * states and full keyboard control.
 *
 * The search box is the point: no dropdown in this app should make you scroll
 * hunting for a country, a currency or a venue. Typing filters the list, and
 * typing a printable character on the closed trigger opens it already filtered.
 *
 * Accessibility: collapsed, the trigger is the widget and carries the label.
 * Expanded, focus moves into the search box — the ARIA combobox — which drives
 * the listbox through `aria-activedescendant`; arrow keys move the active
 * option, Enter selects, Escape and Tab close and hand focus back to the
 * trigger, Home/End jump. With `searchable={false}` the trigger itself is the
 * combobox and keeps focus. Respects prefers-reduced-motion.
 */
export function Select({
  label,
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  searchable = true,
  searchPlaceholder = "Search…",
  noResultsLabel = "No matches",
  id,
  className,
  "aria-label": ariaLabel,
}: SelectProps) {
  const items = useMemo(() => options.map(normalizeOption), [options]);
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const listId = `${triggerId}-list`;

  const select = useSelect({ items, value, onChange, disabled, searchable, listId });
  const { open, filtered, selected, activeIndex } = select;

  const labelText = typeof label === "string" ? label : ariaLabel;
  const searchLabel = labelText ? `Search ${labelText}` : "Search options";

  return (
    <div className={classNames(styles.field, className)}>
      {label && (
        <label htmlFor={triggerId} className={styles.label}>
          {label}
        </label>
      )}
      <button
        ref={select.triggerRef}
        id={triggerId}
        type="button"
        // Expanded, the combobox is the search box inside the popover, so the
        // trigger steps back to a plain disclosure button.
        role={searchable ? undefined : "combobox"}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          !searchable && open && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined
        }
        aria-label={ariaLabel}
        disabled={disabled}
        className={styles.trigger}
        onClick={select.toggle}
        onKeyDown={select.onTriggerKeyDown}
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
        select.menuStyle &&
        createPortal(
          <div ref={select.panelRef} className={styles.panel} style={select.menuStyle}>
            {searchable && (
              <div className={styles.search}>
                <Icon name="search" size={15} className={styles.searchIcon} />
                <input
                  ref={select.searchRef}
                  type="text"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined
                  }
                  aria-label={searchLabel}
                  autoComplete="off"
                  className={styles.searchInput}
                  placeholder={searchPlaceholder}
                  value={select.query}
                  onChange={(changeEvent) => select.setQuery(changeEvent.target.value)}
                  onKeyDown={select.onSearchKeyDown}
                />
              </div>
            )}

            <div ref={select.listRef} id={listId} role="listbox" className={styles.list}>
              {filtered.map((option, index) => {
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
                    onClick={() => select.commit(index)}
                    onMouseEnter={() => !option.disabled && select.setActiveIndex(index)}
                  >
                    <span className={styles.optionLabel}>{option.label}</span>
                    {isSelected && <Icon name="check" size={15} className={styles.check} />}
                  </div>
                );
              })}
            </div>

            {filtered.length === 0 && <div className={styles.noResults}>{noResultsLabel}</div>}

            {searchable && (
              <output aria-live="polite" className={styles.srOnly}>
                {filtered.length === 1 ? "1 option" : `${filtered.length} options`}
              </output>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
