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
      dismissOnScrim={false}
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

        {/* Access is an ORDINARY SELECT now, in both directions.

            It used to be three states, because it had to be: `permissionSetId`
            was optional-not-nullable on the route, so "standard for the role" was
            a thing the API had no way to be told. A collaborator on full control
            got a paragraph explaining that taking it back meant removing them and
            inviting them again. `.nullable()` (ClickUp 86cbazcc7, item 1) makes
            that paragraph obsolete, and a rule that no longer holds is worse than
            no rule at all.

            The panel still disappears entirely for a role that cannot carry full
            control — that ceiling is real (decisions #4), and a select with one
            option is not a question. */}
        {editor.canGrantFullControl && (
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
            {/* Named, because the set is what they actually hold and two sets can
                grant the same thing under different names. */}
            {editor.hasFullControl && editor.currentSetName && (
              <span style={COLLABORATOR_PANEL_STYLE.hint}>
                They currently hold{" "}
                <strong style={{ color: "var(--text)" }}>{editor.currentSetName}</strong>. Setting
                this back to standard returns them to the role's own access.
              </span>
            )}
          </div>
        )}

        {editor.refusal && <CollaboratorCallout>{editor.refusal}</CollaboratorCallout>}
      </div>
    </Modal>
  );
}
