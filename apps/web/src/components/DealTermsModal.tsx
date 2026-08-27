import { Button, Input, Modal, Select } from "@showme/design-system";
import { useState } from "react";
import { VenueNotesField } from "./VenueNotesField";
import type { DealTermsEditor } from "./useDealTermsEditor";

/**
 * Writing an agreement's terms & conditions.
 *
 * A text box and a template, and deliberately nothing else — the product owner
 * asked for both in one breath and *"we are not an agreements app"* in the next,
 * so there is no clause library, no formatting toolbar and no signature block
 * here. The words are stored on the deal and printed by the Share & Export that
 * already carries them.
 *
 * Dumb by construction: every piece of state, the save, and the templates are
 * `useDealTermsEditor`'s. The naming row for "Save as template" is INLINE rather
 * than a second modal, because a dialog opened on top of a dialog is a stack the
 * escape key cannot unwind predictably.
 */
export function DealTermsModal({ editor }: { editor: DealTermsEditor }) {
  return (
    <Modal
      open={editor.subject !== null}
      onClose={editor.close}
      title={editor.subject ? `Terms — ${editor.subject.name}` : "Terms"}
      width={640}
      footer={
        <>
          <Button variant="ghost" onClick={editor.close}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={editor.startNamingTemplate}
            disabled={editor.text.trim() === "" || editor.isNamingTemplate}
          >
            Save as template
          </Button>
          <Button variant="primary" onClick={editor.save} disabled={editor.isSaving}>
            {editor.isSaving ? "Saving…" : "Save terms"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {editor.templates.length > 0 && (
          <Select
            label="Start from a saved template"
            // Always empty: picking a template is an ACTION, not a value the deal
            // then carries — the terms belong to the deal once they are in the box.
            value=""
            placeholder="Apply a saved template…"
            options={editor.templates.map((template) => ({
              value: template.id,
              label: template.name,
            }))}
            onChange={(value) => editor.templates.find((row) => row.id === value)?.apply()}
            searchable={false}
          />
        )}

        <VenueNotesField
          label="Terms & conditions"
          value={editor.text}
          onChange={editor.setText}
          rows={12}
          placeholder={"Cancellation, force majeure, hospitality, payment terms…"}
          hint="Plain text. Every party to this deal sees the same words, and they are frozen into the signed record once everyone has confirmed. shoWMe does not compute anything from them."
        />

        {editor.isNamingTemplate && <TemplateNameRow editor={editor} />}
      </div>
    </Modal>
  );
}

/** The one row "Save as template" adds — a name, and the two buttons for it. */
function TemplateNameRow({ editor }: { editor: DealTermsEditor }) {
  const [name, setName] = useState("");
  const save = () => editor.saveAsTemplate(name);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--card)",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Template name</span>
      <Input
        value={name}
        placeholder="e.g. Standard club terms"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && save()}
      />
      <span style={{ fontSize: 12, color: "var(--muted)" }}>
        Saves this text on your profile for the next deal. It holds no event, no party and no
        figures.
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        <Button
          variant="primary"
          onClick={save}
          disabled={name.trim() === "" || editor.isSavingTemplate}
        >
          {editor.isSavingTemplate ? "Saving…" : "Save template"}
        </Button>
        <Button variant="ghost" onClick={editor.cancelNamingTemplate}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
