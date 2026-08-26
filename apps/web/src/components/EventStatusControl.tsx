import { Select } from "@showme/design-system";
import { Eyebrow } from "./eventUi";
import { type EditableEventStatus, useEventStatusEditor } from "./useEventStatusEditor";

/**
 * The event's status, as something the operator SETS rather than something that
 * happens to them. It sits under the stage rail because the rail is where the
 * status is already being read — one place to see it and one place to move it.
 *
 * Dumb by design: the vocabulary, the write and the refusal all live in
 * `useEventStatusEditor`, which is also where the reasoning is written down.
 */
export interface EventStatusControlProps {
  event: EditableEventStatus;
}

export function EventStatusControl({ event }: EventStatusControlProps) {
  const editor = useEventStatusEditor(event);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "18px 0 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Eyebrow>Status</Eyebrow>
        <div style={{ width: 180 }}>
          <Select
            value={editor.status}
            onChange={editor.setStatus}
            options={editor.options.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            disabled={editor.isSaving}
            searchable={false}
            aria-label="Event status"
          />
        </div>
        {editor.isSaving && <span style={{ color: "var(--muted)", fontSize: 12.5 }}>Saving…</span>}
      </div>
      {editor.current && (
        <span style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.45 }}>
          {editor.current.description}
        </span>
      )}
      {editor.refusal && (
        <output
          style={{
            display: "block",
            color: "var(--text)",
            fontSize: 12.5,
            lineHeight: 1.45,
            padding: "9px 12px",
            borderRadius: 10,
            border: "1px solid color-mix(in srgb, var(--brand-red) 45%, transparent)",
            background: "color-mix(in srgb, var(--brand-red) 10%, transparent)",
          }}
        >
          {editor.refusal}
        </output>
      )}
    </div>
  );
}
