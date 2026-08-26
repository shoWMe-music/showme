import { Button, EmptyState, Icon, Input, ListRow, Modal } from "@showme/design-system";
import { useEffect, useState } from "react";
import type { BudgetToolbar } from "./useBudgetToolbar";

/**
 * The two dialogs behind "Save as Template" and "Load Template".
 *
 * Both are presentational — the toolbar hook owns every decision, these only
 * render and emit (CLAUDE.md). They are one file because they are one feature and
 * neither is big enough to earn its own.
 */
export function BudgetTemplateDialogs({ toolbar }: { toolbar: BudgetToolbar }) {
  return (
    <>
      <SaveTemplateDialog toolbar={toolbar} />
      <LoadTemplateDialog toolbar={toolbar} />
    </>
  );
}

function SaveTemplateDialog({ toolbar }: { toolbar: BudgetToolbar }) {
  const [name, setName] = useState("");

  // Cleared on open, so the previous name is never seen fading out.
  useEffect(() => {
    if (toolbar.isNaming) setName("");
  }, [toolbar.isNaming]);

  const save = () => toolbar.saveAs(name);

  return (
    <Modal
      open={toolbar.isNaming}
      onClose={toolbar.closeNaming}
      title="Save as template"
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={toolbar.closeNaming}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={name.trim() === "" || toolbar.isSaving}
          >
            {toolbar.isSaving ? "Saving…" : "Save template"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Template name</span>
        <Input
          value={name}
          placeholder="e.g. Club night — 400 cap"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && save()}
        />
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          Saves the ticket tiers, capacity, costs and provider rates as they stand — not this event,
          and not any of its participants.
        </span>
      </div>
    </Modal>
  );
}

function LoadTemplateDialog({ toolbar }: { toolbar: BudgetToolbar }) {
  return (
    <Modal
      open={toolbar.isPickerOpen}
      onClose={toolbar.closePicker}
      title="Load template"
      width={480}
    >
      {toolbar.templates.length === 0 ? (
        <EmptyState
          icon={<Icon name="file" />}
          title="No saved budget templates"
          description="Save a budget as a template and it will be here for the next show."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Said out loud, because loading is destructive: it fills every field
              on the screen, replacing whatever is in them. */}
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Loading a template replaces the figures currently on this budget.
          </span>
          {toolbar.templates.map((template) => (
            <ListRow
              key={template.id}
              title={template.name}
              interactive
              onClick={template.apply}
              trailing={<Icon name="chevron-right" size={16} />}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}
