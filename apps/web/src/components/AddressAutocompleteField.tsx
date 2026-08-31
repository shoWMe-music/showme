import { Icon, Spinner } from "@showme/design-system";
import { type KeyboardEvent, useId, useState } from "react";
import { type AddressSuggestion, useAddressSearch } from "./useAddressSearch";

export interface AddressAutocompleteFieldProps {
  label: string;
  /** The street line as it will be saved — always the owner's to type over. */
  value: string;
  /** They typed. Whatever coordinates were attached no longer describe this text. */
  onChangeText: (value: string) => void;
  /** They picked one. The address parts AND the map pin come from it. */
  onSelect: (suggestion: AddressSuggestion) => void;
  /** The profile's country, to narrow the search. */
  countryHint?: string;
  placeholder?: string;
  hint?: string;
  /** Rendered under the field once a pin exists — proof the map has something to plot. */
  footer?: React.ReactNode;
}

/**
 * The street field, with address suggestions behind it.
 *
 * Why it exists: `profile_locations.lat`/`.lng` have been in the schema since
 * migration 0014 and were never once written, because nothing in the app could
 * turn "Hornsgatan 12" into a pair of numbers. Picking a suggestion is what
 * writes them.
 *
 * Typing is still the primary interaction and always works. A venue that is not
 * in the provider's index, or a deployment with no geocoding token at all, gets
 * exactly the text box it had before — the suggestions are an offer, never a
 * gate. `useAddressSearch` owns the fetching, the debounce and the "this
 * deployment cannot geocode" verdict; what is left here is view state (is the
 * list open, which row is under the keyboard) and markup.
 */
export function AddressAutocompleteField({
  label,
  value,
  onChangeText,
  onSelect,
  countryHint,
  placeholder,
  hint,
  footer,
}: AddressAutocompleteFieldProps) {
  const fieldId = useId();
  const listId = `${fieldId}-suggestions`;
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const { suggestions, isSearching, isUnavailable } = useAddressSearch({
    query: value,
    countryHint,
    enabled: open,
  });

  const showList = open && !isUnavailable && (suggestions.length > 0 || isSearching);

  const choose = (suggestion: AddressSuggestion) => {
    onSelect(suggestion);
    setOpen(false);
    setActiveIndex(-1);
  };

  const onKeyDown = (keyEvent: KeyboardEvent<HTMLInputElement>) => {
    if (keyEvent.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!showList || suggestions.length === 0) return;
    if (keyEvent.key === "ArrowDown" || keyEvent.key === "ArrowUp") {
      keyEvent.preventDefault();
      const step = keyEvent.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        const next = current + step;
        if (next < 0) return suggestions.length - 1;
        if (next >= suggestions.length) return 0;
        return next;
      });
      return;
    }
    if (keyEvent.key === "Enter" && activeIndex >= 0) {
      const suggestion = suggestions[activeIndex];
      // Enter inside a form submits it. When it is choosing an address instead,
      // say so — otherwise picking a suggestion saves the profile.
      if (suggestion) {
        keyEvent.preventDefault();
        choose(suggestion);
      }
    }
  };

  return (
    <div style={{ display: "block", position: "relative" }}>
      <label
        htmlFor={fieldId}
        style={{
          display: "block",
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--muted)",
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          boxSizing: "border-box",
          padding: "0 12px",
          minHeight: "var(--control-height)",
          borderRadius: 10,
          // TextField's own focus colour, tracked in React because a style object
          // cannot express `:focus-within`.
          border: `1px solid ${focused ? "var(--brand-red)" : "var(--control-border)"}`,
          background: "var(--control-surface)",
          transition: "border-color var(--duration-quick)",
        }}
      >
        <Icon name="map-pin" size={15} />
        <input
          id={fieldId}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
          onFocus={() => {
            setFocused(true);
            setOpen(true);
          }}
          onBlur={() => setFocused(false)}
          onChange={(changeEvent) => {
            onChangeText(changeEvent.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            background: "transparent",
            color: "var(--text)",
            fontFamily: "var(--font-sans)",
            fontSize: 13.5,
            lineHeight: "var(--control-line-height)",
            outline: "none",
          }}
        />
        {isSearching && <Spinner size={14} />}
      </span>

      {hint && <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--dim)" }}>{hint}</p>}
      {footer}

      {showList && (
        <>
          {/* Clicking anywhere else closes the list. A transparent full-screen
              button rather than a document listener: it is one element, it is
              reachable by assistive tech, and it cannot leak past unmount. */}
          <button
            type="button"
            aria-label="Close address suggestions"
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
          {/* An ARIA combobox popup. There is no semantic element for it: the
              native equivalent biome suggests is `<select>`, which cannot hold a
              free-text input, and the listbox is driven by the input above
              through `aria-activedescendant` rather than by its own focus. Same
              construction as the design system's own `Select` popover.

              `role` is the FIRST attribute on both elements deliberately: biome
              suppresses only the line immediately after the comment, and the
              diagnostic is anchored to whatever precedes `role`. Move it down
              the attribute list and the suppressions below stop working. */}
          {/* biome-ignore lint/a11y/useSemanticElements: no native listbox exists for a combobox popup — see above. */}
          {/* biome-ignore lint/a11y/useFocusableInteractive: focus stays on the input; the active option is named by aria-activedescendant. */}
          <div
            role="listbox"
            id={listId}
            aria-label={`${label} suggestions`}
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              // Pinned to the field's own box on both sides, so the list can
              // never be wider than the column it sits in — the phone audit
              // measures sideways scroll from 360px up.
              left: 0,
              right: 0,
              zIndex: 41,
              maxHeight: 260,
              overflowY: "auto",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "var(--shadow-lg)",
              padding: 6,
            }}
          >
            {suggestions.map((suggestion, index) => (
              // biome-ignore lint/a11y/useSemanticElements: an option inside an ARIA listbox; a native <option> cannot live outside <select>.
              <button
                role="option"
                key={suggestion.id}
                id={`${listId}-option-${index}`}
                type="button"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                // `onMouseDown` and not `onClick`: the input's blur fires first
                // otherwise and can close the list out from under the pointer.
                onMouseDown={(mouseEvent) => {
                  mouseEvent.preventDefault();
                  choose(suggestion);
                }}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 10px",
                  borderRadius: 9,
                  border: 0,
                  background: index === activeIndex ? "var(--elevated)" : "transparent",
                  color: "var(--text)",
                  fontSize: 13.5,
                  cursor: "pointer",
                }}
              >
                <Icon name="map-pin" size={14} />
                {/* `overflowWrap` and not `nowrap`: a long address on a 360px
                    phone must wrap inside the list, not widen it. */}
                <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                  {suggestion.label}
                </span>
              </button>
            ))}
            {suggestions.length === 0 && (
              <div style={{ padding: "10px 12px", color: "var(--muted)", fontSize: 12.5 }}>
                Looking…
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
