import { Button, Icon, useToast } from "@showme/design-system";
import { type CSSProperties, useState } from "react";
import { ConfirmDialog, useConfirmDialog } from "./ConfirmDialog";
import { useEventPublishing } from "./useEventPublishing";

export interface EventPublishPanelProps {
  eventId: string;
  /** The edit form above has changes that aren't saved yet. */
  hasUnsavedChanges: boolean;
  /** The modal lost its optimistic lock — nothing here may be acted on either. */
  disabled: boolean;
}

/**
 * "Public event page" — the publish control, at the foot of the Event
 * Information card.
 *
 * WHY IT IS NOT A CHECKBOX AMONG THE FIELDS. Every other control on that card
 * edits a value. Publishing is none of those things: it takes effect the moment
 * it is confirmed, it goes through its own route and its own capability
 * (`event.publish`), it writes a line into the event's history that every
 * participant can read — and it puts a page about a real show on the public
 * internet, which is the one action here that a stranger can see the result of.
 * A tick box between "Venue" and "Capacity" would say the opposite of all of
 * that. So it gets its own panel, a button that names the act, and a
 * confirmation that says what the act exposes.
 *
 * WHY THE PANEL ITSELF CARRIES NO PROSE. It used to explain, in two paragraphs
 * above the button, what a visitor would and would not see. That is the answer
 * to "what am I about to expose?" — a question asked BEFORE publishing, not a
 * block of text scrolled past by someone who already did. The lists now live in
 * the publish confirmation, where they are the substance of the decision; the
 * panel is left with the state, the address and the act.
 *
 * NAMING follows the previous app (`../showme-settle-fast`): **Publish** /
 * **Unpublish**, **Published** as the state, "Event published" / "Event
 * unpublished" as the toasts. It did not confirm before publishing — the modal
 * is new — but its vocabulary is what operators already have in their hands.
 */
export function EventPublishPanel({
  eventId,
  hasUnsavedChanges,
  disabled,
}: EventPublishPanelProps) {
  const toast = useToast();
  const publishing = useEventPublishing(eventId, { hasUnsavedChanges });
  const confirmation = useConfirmDialog();

  if (publishing.isLoading) return null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publishing.publicUrl);
      toast.success("Link copied");
    } catch {
      // Clipboard access can be refused (permissions, an insecure origin). The
      // link is on screen and selectable, so say so instead of failing silently.
      toast.error("Couldn't copy — select the link and copy it by hand.");
    }
  };

  const askToPublish = () =>
    confirmation.ask({
      title: "Publish this event?",
      body: <PublishConsequences />,
      confirmLabel: "Publish",
      onConfirm: publishing.publish,
    });

  // Destructive, so the dialog opens on Cancel rather than on the act: taking a
  // page down breaks a link that is already out in the world, and the person
  // holding it gets nothing back.
  const askToUnpublish = () =>
    confirmation.ask({
      title: "Unpublish this event?",
      body: <UnpublishConsequences />,
      confirmLabel: "Unpublish",
      destructive: true,
      onConfirm: publishing.unpublish,
    });

  return (
    <section
      style={{
        borderTop: "1px solid var(--border)",
        paddingTop: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="eye" size={16} />
        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>
          Public event page
        </span>
        <StatePill published={publishing.published} />
      </div>

      {publishing.published ? (
        <>
          <PublicLink url={publishing.publicUrl} onCopy={copyLink} />
          <div>
            <Button
              variant="ghost"
              onClick={askToUnpublish}
              disabled={disabled || publishing.isWorking}
            >
              {publishing.isWorking ? "Unpublishing…" : "Unpublish"}
            </Button>
          </div>
        </>
      ) : (
        <>
          {publishing.blockedReason && <BlockedNotice reason={publishing.blockedReason} />}
          <div>
            <Button
              variant="primary"
              onClick={askToPublish}
              disabled={disabled || !publishing.canPublish}
            >
              {publishing.isWorking ? "Publishing…" : "Publish"}
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog {...confirmation.dialogProps} />
    </section>
  );
}

/**
 * What publishing exposes — the substance of the publish confirmation.
 *
 * The lists are a transcription of `serializePublicEvent`
 * (`apps/api/src/serialize/public.ts`), which selects six columns and no others:
 * id, title, eventDate, venueName, doorTime, startTime. Everything named under
 * "They never see" is a column that endpoint never reads, so it cannot leak. If
 * that allowlist ever gains a field, this copy is wrong until it gains the same
 * one.
 *
 * Written positively AND negatively because the question an operator actually
 * has is the second one: an event carries a budget, deals and other people's
 * fees, and "we only publish the poster" is only reassuring once the things left
 * out are named.
 *
 * A `<dl>` because that is what this is: two terms, each with its description.
 * The pairing is the meaning here — "Visitors see" is worth nothing without the
 * line under it — so a reader on a screen reader should meet them joined, not as
 * four loose runs of text. This used to be `display: block` spans faking the
 * structure, because {@link ConfirmDialog} wrapped its body in a `<p>`; that
 * wrapper is a `<div>` now, so the honest elements are available.
 */
function PublishConsequences() {
  return (
    <>
      <p style={consequenceParagraph}>
        The page goes up the moment you confirm. Anyone with the link can open it and RSVP — no
        shoWMe account needed — and everyone on the bill sees in the event's history that you
        published it.
      </p>
      <dl style={consequenceList}>
        <dt style={consequenceTerm}>Visitors see</dt>
        <dd style={consequenceDetail}>
          the event name, the date, the venue name, and the doors / show times.
        </dd>
        <dt style={consequenceTerm}>They never see</dt>
        <dd style={consequenceDetail}>
          the budget, deals or fees, who is on the bill, participants' contact details, your guest
          list, ticket tiers, capacity, or your notes.
        </dd>
      </dl>
    </>
  );
}

/**
 * What unpublishing costs — a different consequence, so different words.
 *
 * The link is the point. A published page's address has usually been sent
 * somewhere by the time anyone thinks about taking it down, and unpublishing
 * does not retract those copies — it turns them into a page reading "This event
 * isn't public" (`apps/marketing/src/event.ts`). Saying only "the page comes
 * down" would hide the half that happens to other people.
 *
 * The address is derived from the event id, so republishing restores the very
 * same URL. That is worth saying: it is the difference between a reversible act
 * and a lost link.
 */
function UnpublishConsequences() {
  return (
    <>
      <p style={consequenceParagraph}>
        The page comes down the moment you confirm. The link itself keeps working, but everyone
        already holding it — on a poster, in a post, in a message — lands on "This event isn't
        public" instead of the show.
      </p>
      <p style={consequenceFollowingParagraph}>
        Nothing else changes: the event, the bill, the deals and the budget stay exactly as they
        are, and you can publish it again at any time. The link will be the same one.
      </p>
    </>
  );
}

// The dialog body sets the colour, size and leading; these only place the parts.
// Every one of them zeroes a browser default — <p>, <dl> and <dd> all arrive with
// margins of their own, and <dd> with a 40px indent — so the spacing below is the
// only spacing there is.

const consequenceParagraph: CSSProperties = { margin: 0 };

/**
 * A paragraph that follows another paragraph rather than a term. Terms bring
 * their own gap and a description belongs tight beneath its term, so the space
 * is put on the one element that needs it instead of on the shared rule.
 */
const consequenceFollowingParagraph: CSSProperties = { margin: "10px 0 0" };

const consequenceList: CSSProperties = { margin: 0 };

const consequenceTerm: CSSProperties = {
  marginTop: 12,
  color: "var(--text)",
  fontWeight: 600,
};

/** Zeroes the `<dd>` indent as well as its margin — the term is the only label. */
const consequenceDetail: CSSProperties = { margin: 0 };

function StatePill({ published }: { published: boolean }) {
  // `--muted`, not `--dim`, for the off state: --dim is tuned to recede on the
  // light paper and all but disappears on the dark ground, and "Not published"
  // is a state the operator has to be able to read at a glance in both.
  const tone = published ? "#6FC97A" : "var(--muted)";
  return (
    <span
      style={{
        marginLeft: "auto",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11.5,
        color: tone,
        border: `1px solid color-mix(in srgb,${tone} 40%,transparent)`,
        borderRadius: 999,
        padding: "2px 9px",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: tone }} />
      {published ? "Published" : "Not published"}
    </span>
  );
}

/**
 * The precondition, before the click rather than after it — and before the
 * modal, so a confirmation is never offered for an act the API would refuse.
 */
function BlockedNotice({ reason }: { reason: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 9,
        background: "color-mix(in srgb,var(--brand-amber) 12%,transparent)",
        border: "1px solid color-mix(in srgb,var(--brand-amber) 30%,transparent)",
        borderRadius: 11,
        padding: "10px 13px",
        color: "#c8842f",
        fontSize: 12.5,
        lineHeight: 1.5,
      }}
    >
      <Icon name="alert" size={16} />
      <span>{reason}</span>
    </div>
  );
}

/**
 * The public link, as one control rather than a field with a button beside it.
 *
 * Copy belongs INSIDE the box for the same reason it does in every share dialog
 * people already know: the button is an action on the value, so putting it
 * outside makes the reader decide which of two adjacent things it acts on. It
 * also stops the button stealing width from a URL that is already ellipsised.
 */
function PublicLink({ url, onCopy }: { url: string; onCopy: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        // The same two tokens every input in the app wears — white ground, brand
        // edge — so a read-only value reads as the same kind of object as a
        // typed one. It was on --elevated, the warm tint, which in light mode
        // made it the only beige box on a white card.
        background: "var(--control-surface)",
        border: "1px solid var(--control-border)",
        borderRadius: 10,
        minHeight: "var(--control-height)",
        paddingLeft: 11,
        overflow: "hidden",
      }}
    >
      {/* Still a real link. The Open-link button beside it is the discoverable
          affordance, but the URL is the thing a reader's eye lands on and
          reaching for it should work — a link-shaped string that refuses a click
          is the small kind of broken that makes a page feel dead. */}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={(hover) => {
          hover.currentTarget.style.color = "var(--accent)";
          hover.currentTarget.style.textDecoration = "underline";
        }}
        onMouseLeave={(hover) => {
          hover.currentTarget.style.color = "var(--text)";
          hover.currentTarget.style.textDecoration = "none";
        }}
        style={{
          flex: 1,
          minWidth: 0,
          alignSelf: "center",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text)",
          textDecoration: "none",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          transition: "color var(--duration-quick) var(--ease-out)",
        }}
      >
        {url}
      </a>
      <LinkAction icon="copy" label="Copy" onClick={onCopy} />
      <LinkAction
        icon="arrow-right"
        label="Open link"
        onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
      />
    </div>
  );
}

/**
 * One of the two actions living inside the link field.
 *
 * Borderless on purpose: a bordered button inside a bordered field draws a box
 * in a box, and there are two of them. They read as part of the field until you
 * reach for one, and then they light up — which is the same rule the style guide
 * gives for everything else, applied to a control that has no edge of its own to
 * promote (STYLE-GUIDE.md §2: hover is the brand, never a ground).
 */
function LinkAction({
  icon,
  label,
  onClick,
}: {
  icon: "copy" | "arrow-right";
  label: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      title={label}
      // Touch: 42px tall — two pixels short, because it stretches to a field
      // that is 42 tall. Growing it lifts the field with it, which is the right
      // outcome; an overlay would hang over the URL link beside it.
      className="touch-target"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
        alignSelf: "stretch",
        padding: "0 12px",
        border: 0,
        background: "transparent",
        cursor: "pointer",
        fontSize: 12.5,
        fontWeight: 500,
        whiteSpace: "nowrap",
        color: hovered ? "var(--accent)" : "var(--muted)",
        transition: "color var(--duration-quick) var(--ease-out)",
      }}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}
