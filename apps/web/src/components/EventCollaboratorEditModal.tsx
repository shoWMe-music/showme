import { Button, Modal, Select } from "@showme/design-system";
import type { EventCollaboratorEditor } from "../hooks/useEventCollaborators";
import {
  ACCESS_OPTIONS,
  COLLABORATOR_PANEL_STYLE,
  CollaboratorCallout,
} from "./EventCollaboratorInviteModal";
import { Eyebrow } from "./primitives";
import type { EventCollaboratorAccess } from "./useEventCollaboratorInvite";

/**
 * Changing what somebody already on the event may do — the counterpart to
 * `EventCollaboratorInviteModal`, and deliberately the same two questions in the
 * same words and the same furniture: which **role** they hold on this event, and
 * which **access** that role is given. A person whose role reads "Crew" on the
 * invite and "Crew member" on the edit is two different grants as far as the
 * reader is concerned.
 *
 * What it does NOT offer, and why — the route
 * (`PATCH /events/:id/participants/:pid`) takes exactly four fields:
 *
 *  - **Their name and email are not among them.** Those belong to the
 *    collaborator's own profile, which this operator does not own. The panel says
 *    so rather than leaving the reader hunting for the field.
 *  - **`status`** is the collaborator's own answer to the invitation, so it is
 *    not an operator's to type. Removing is the DELETE beside this in the menu.
 *  - **`performerTag`** (headliner / support / DJ / opener) is billing, and is set
 *    where the bill is built.
 *
 * Dumb by design: every decision — which roles exist, what is refused, what is
 * sent — is in `useEventCollaborators`.
 */
export function EventCollaboratorEditModal({ editor }: { editor: EventCollaboratorEditor | null }) {
  if (!editor) return null;
  const accessDescription = ACCESS_OPTIONS.find(
    (option) => option.value === editor.access,
  )?.description;

  return (
    <Modal
      open={editor.open}
      onClose={editor.close}
      title={`Edit ${editor.displayName}`}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={editor.close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={editor.submit}
            disabled={!editor.hasChanges || editor.pending}
          >
            {editor.pending ? "Saving…" : "Save changes"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={COLLABORATOR_PANEL_STYLE.paragraph}>
          This is their standing on <strong style={{ color: "var(--text)" }}>this event</strong>{" "}
          only. Their name, avatar and email belong to their own profile and are theirs to change.
        </p>

        <div style={COLLABORATOR_PANEL_STYLE.fieldGroup}>
          <Eyebrow>Role on this event</Eyebrow>
          <Select
            value={editor.role}
            onChange={editor.setRole}
            options={editor.roleOptions.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            aria-label="Role on this event"
          />
          {editor.roleDescription && (
            <span style={COLLABORATOR_PANEL_STYLE.hint}>{editor.roleDescription}</span>
          )}
        </div>

        {/* Access is a one-way door, so the panel is in one of three states, never
            a select that pretends otherwise: already granted (nothing to do),
            grantable (choose), or not a grant this role may hold at all. */}
        {editor.hasFullControl ? (
          <div style={COLLABORATOR_PANEL_STYLE.fieldGroup}>
            <Eyebrow>Access</Eyebrow>
            <span style={COLLABORATOR_PANEL_STYLE.hint}>
              They hold full control of this event — the same set the host does. Taking it back
              isn't something this screen can do: remove them and invite them again at the access
              you want.
            </span>
          </div>
        ) : (
          editor.canGrantFullControl && (
            <div style={COLLABORATOR_PANEL_STYLE.fieldGroup}>
              <Eyebrow>Access</Eyebrow>
              <Select
                value={editor.access}
                onChange={(value) => editor.setAccess(value as EventCollaboratorAccess)}
                options={ACCESS_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                aria-label="Access"
              />
              {accessDescription && (
                <span style={COLLABORATOR_PANEL_STYLE.hint}>{accessDescription}</span>
              )}
              {editor.access === "full_control" && (
                <span style={COLLABORATOR_PANEL_STYLE.hint}>
                  Granting this cannot be undone from this screen — say it now rather than discover
                  it later.
                </span>
              )}
            </div>
          )
        )}

        {editor.refusal && <CollaboratorCallout>{editor.refusal}</CollaboratorCallout>}
      </div>
    </Modal>
  );
}
