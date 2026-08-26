import { TextField } from "@showme/design-system";
import type { CSSProperties } from "react";

/**
 * Who the invitation is addressed to, as first name and last name.
 *
 * **The split is presentational only.** `invitations.recipient_name` is a single
 * nullable text column and `POST /invitations` takes one `recipientName`, so the
 * two fields are joined by {@link combineName} before they are sent. Nothing
 * downstream can tell the halves apart — the stored name is used to greet the
 * recipient in the invitation email (`Hi {recipientName},`) and to title the
 * "X accepted" notification. Storing them separately would need a schema change;
 * see the note in the handoff rather than assuming the API can already do it.
 *
 * **Neither field is required**, and separating them is not a reason to change
 * that. The whole name is optional today — an invitation needs only an email —
 * and this industry is full of people whose name genuinely is one word: a DJ or
 * solo artist booked under a stage name, a crew member you know as "Nico". A
 * required surname would block inviting them at all, to buy a tidier greeting.
 * (`docs/story.md`, Performer: "a band, DJ, or solo artist".)
 */

export interface InviteNameFieldsProps {
  firstName: string;
  lastName: string;
  onFirstNameChange: (value: string) => void;
  onLastNameChange: (value: string) => void;
}

/** The two halves as one stored name, tolerating either half being blank. */
export function combineName(firstName: string, lastName: string): string {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
}

export function InviteNameFields({
  firstName,
  lastName,
  onFirstNameChange,
  onLastNameChange,
}: InviteNameFieldsProps) {
  return (
    <div style={groupStyle}>
      <div style={rowStyle}>
        <TextField
          label="First name"
          value={firstName}
          placeholder="Nils"
          autoComplete="given-name"
          onChange={(changeEvent) => onFirstNameChange(changeEvent.target.value)}
        />
        <TextField
          label="Last name"
          value={lastName}
          placeholder="Andersson"
          autoComplete="family-name"
          onChange={(changeEvent) => onLastNameChange(changeEvent.target.value)}
        />
      </div>
      <span style={hintStyle}>
        Optional — it only addresses the invitation email. One name is fine.
      </span>
    </div>
  );
}

const groupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 10,
};

const hintStyle: CSSProperties = {
  color: "var(--muted)",
  fontSize: 12,
  lineHeight: 1.45,
};
