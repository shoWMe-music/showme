import { Badge, Button, Checkbox, Icon, Input, Modal } from "@showme/design-system";
import { formatDay } from "../lib/format";
import { SHARE_SCOPES, type ShareScope, shareScopeLabel } from "../lib/shareScope";
import { Eyebrow } from "./primitives";
import { ErrorState, LoadingState } from "./states";
import { useShareExport } from "./useShareExport";

/**
 * Share & Export — the door onto the off-platform surface.
 *
 * Three questions in the old app's order, because it is the right one: **what**
 * is being shared, **who** it goes to, **how** it leaves (print · file · link).
 *
 * Two departures from the old app, both deliberate:
 *
 * - **There is no Public tier and therefore no consent gate.** The old dialog
 *   offered an anonymous link behind a liability disclaimer; the owner's answer
 *   (Q17) is that a share is addressed to an email and redeemed with a code, so
 *   the honest version of that screen is one that never offers the choice. The
 *   most honest piece of UX in the old app was a warning about a decision we have
 *   since decided not to let anyone make.
 * - **"What" is a capability list, not a section tree.** Each tick is exactly one
 *   entry in `shares.capabilities`, which is the same vocabulary the authorization
 *   engine reads, so the tick-box and the grant cannot drift.
 */
export interface ShareExportModalProps {
  open: boolean;
  onClose: () => void;
  eventId: string;
}

export function ShareExportModal({ open, onClose, eventId }: ShareExportModalProps) {
  const share = useShareExport(eventId, open);
  const viewScopes = SHARE_SCOPES.filter((scope) => scope.kind === "view");
  const actScopes = SHARE_SCOPES.filter((scope) => scope.kind === "act");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Share & Export"
      width={720}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {share.isPending ? (
        <LoadingState label="Loading the event" />
      ) : share.isError ? (
        <ErrorState error={share.error} title="Couldn't load this event" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Section
            step="1"
            title="What are you sharing?"
            note="Only what you can see yourself. A recipient never gets more than their own line."
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* `capabilities`, not `selected` — a scope pulled in by something
                  else must show as ticked. Approving a settlement you were never
                  shown is not a thing to ask anyone to do, so ticking "Approve
                  the settlement" shares it; the box has to say so. */}
              {viewScopes.map((scope) => (
                <ScopeRow
                  key={scope.capability}
                  scope={scope}
                  checked={share.capabilities.includes(scope.capability)}
                  disabled={!share.canShare(scope.capability)}
                  onToggle={() => share.toggle(scope.capability)}
                />
              ))}
            </div>
            <Eyebrow style={{ marginTop: 4 }}>And what they may do</Eyebrow>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {actScopes.map((scope) => (
                <ScopeRow
                  key={scope.capability}
                  scope={scope}
                  checked={share.capabilities.includes(scope.capability)}
                  disabled={!share.canShare(scope.capability)}
                  onToggle={() => share.toggle(scope.capability)}
                />
              ))}
            </div>
          </Section>

          <Section
            step="2"
            title="Who is it for?"
            note="Every link is addressed to an email and opened with a one-time code. There are no anonymous links."
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: "2 1 220px" }}>
                <Input
                  value={share.emailDraft}
                  placeholder="name@example.com"
                  aria-label="Recipient email"
                  onChange={(event) => share.setEmailDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      share.addRecipient();
                    }
                  }}
                />
              </div>
              <div style={{ flex: "1 1 140px" }}>
                <Input
                  value={share.nameDraft}
                  placeholder="Name (optional)"
                  aria-label="Recipient name"
                  onChange={(event) => share.setNameDraft(event.target.value)}
                />
              </div>
              <Button variant="secondary" onClick={share.addRecipient}>
                Add
              </Button>
            </div>
            {share.recipients.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                {share.recipients.map((recipient) => (
                  <span key={recipient.email} style={recipientChipStyle}>
                    {recipient.name ? `${recipient.name} · ` : ""}
                    {recipient.email}
                    <button
                      type="button"
                      aria-label={`Remove ${recipient.email}`}
                      onClick={() => share.removeRecipient(recipient.email)}
                      style={chipRemoveStyle}
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </Section>

          <Section step="3" title="How does it leave?">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button
                variant="secondary"
                leftIcon={<Icon name="file" size={14} />}
                onClick={share.print}
              >
                Print / PDF
              </Button>
              <Button
                variant="secondary"
                leftIcon={<Icon name="download" size={14} />}
                onClick={share.downloadCsv}
              >
                CSV
              </Button>
              <Button
                variant="cta"
                leftIcon={<Icon name="share" size={14} />}
                onClick={share.create}
                disabled={
                  share.isCreating ||
                  share.recipients.length === 0 ||
                  share.capabilities.length === 0
                }
              >
                {share.isCreating ? "Creating…" : "Create link"}
              </Button>
            </div>
            {share.recipients.length === 0 && (
              <div style={{ color: "var(--muted)", fontSize: 12.5 }}>
                Add at least one recipient to create a link. Print and CSV need nobody.
              </div>
            )}
            {share.createdUrl !== null && (
              <CreatedLinkPanel url={share.createdUrl} onCopy={share.copyLink} />
            )}
          </Section>

          {share.links.length > 0 && (
            <Section step="" title="Links already out">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {share.links.map((link) => (
                  <LinkRow key={link.id} link={link} onRevoke={() => share.revoke(link.id)} />
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </Modal>
  );
}

function Section({
  step,
  title,
  note,
  children,
}: {
  step: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        {step && <Eyebrow>{step}</Eyebrow>}
        <span style={{ color: "var(--text)", fontWeight: 600, fontSize: 14 }}>{title}</span>
      </div>
      {note && <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{note}</div>}
      {children}
    </div>
  );
}

/**
 * One capability, as a tick-box with the sentence that says what it means.
 *
 * Disabled when the sharer does not hold it themselves — the API refuses that
 * grant, so offering it would be offering a button that 403s.
 */
function ScopeRow({
  scope,
  checked,
  disabled,
  onToggle,
}: {
  scope: ShareScope;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ display: "flex", opacity: disabled ? 0.45 : 1 }}>
      <Checkbox
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        label={
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ color: "var(--text)", fontSize: 13.5, fontWeight: 500 }}>
              {scope.label}
            </span>
            <span style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>
              {disabled
                ? "You don't hold this on this event, so you can't share it."
                : scope.description}
            </span>
          </span>
        }
      />
    </div>
  );
}

/**
 * The link, as a rule and a block — not a card.
 *
 * STYLE-GUIDE.md §1: "a grouped block is a rule, not a box." Inside a modal, whose
 * surface is already white, a `Card` draws a second white box within a white box;
 * the dialog was four of them stacked. A hairline and space group these just as
 * well and leave the modal reading as one surface.
 */
function CreatedLinkPanel({ url, onCopy }: { url: string; onCopy: (url: string) => void }) {
  return (
    <div style={groupedBlockStyle}>
      <Eyebrow>The link</Eyebrow>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <code
          style={{
            flex: "1 1 260px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text)",
            wordBreak: "break-all",
          }}
        >
          {url}
        </code>
        <Button
          variant="secondary"
          leftIcon={<Icon name="copy" size={14} />}
          onClick={() => onCopy(url)}
        >
          Copy
        </Button>
      </div>
      <div style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>
        Anyone opening it has to prove the email address it was sent to. It reads live data — revoke
        it and it stops working immediately.
      </div>
    </div>
  );
}

interface OwnedLink {
  id: string;
  capabilities: string[];
  createdAt: string;
  revokedAt: string | null;
  recipients: {
    email: string;
    name: string | null;
    lastSeenAt: string | null;
    claimed: boolean;
  }[];
}

function LinkRow({ link, onRevoke }: { link: OwnedLink; onRevoke: () => void }) {
  const revoked = link.revokedAt != null;
  return (
    <div style={{ ...groupedBlockStyle, opacity: revoked ? 0.55 : 1 }}>
      {/* The scope list is the part that wraps; Revoke stays on the first line at
          the right edge, because a control that jumps below a paragraph of text
          when the paragraph gets longer is a control you have to hunt for. */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span style={{ color: "var(--text)", fontSize: 13, flex: 1, minWidth: 0 }}>
          {link.capabilities.map(shareScopeLabel).join(" · ")}
        </span>
        {revoked ? (
          <Badge status="cancelled" dot>
            Revoked
          </Badge>
        ) : (
          <div style={{ flexShrink: 0 }}>
            <Button variant="secondary" onClick={onRevoke}>
              Revoke
            </Button>
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {link.recipients.map((recipient) => (
          <span key={recipient.email} style={{ color: "var(--muted)", fontSize: 12 }}>
            {recipient.name ? `${recipient.name} · ` : ""}
            {recipient.email} —{" "}
            {recipient.lastSeenAt ? `opened ${formatDay(recipient.lastSeenAt)}` : "not opened yet"}
            {recipient.claimed ? " · has a shoWMe account" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * A block of related lines inside the dialog: a hairline above it and space around
 * it, with no ground and no border of its own (STYLE-GUIDE.md §1).
 */
const groupedBlockStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  borderTop: "1px solid var(--border)",
  paddingTop: 12,
} as const;

/**
 * A removable recipient token.
 *
 * Hand-composed rather than `Chip`, which is the FILTER chip — a button with a
 * pressed state — so a recipient rendered as one would be a control that does
 * nothing when clicked. The design system has no removable-token primitive.
 *
 * `--shape-fill`, not `--elevated`: `--elevated` is WHITE in light mode now
 * (STYLE-GUIDE.md §1), so a pill filled with it on a white modal had no fill at
 * all. A recipient token is a small SHAPE the eye counts, which is exactly what
 * `--shape-fill` was added for.
 */
const recipientChipStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 8px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "var(--shape-fill)",
  color: "var(--text)",
  fontSize: 12.5,
} as const;

const chipRemoveStyle = {
  display: "inline-flex",
  border: 0,
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  padding: 0,
} as const;
