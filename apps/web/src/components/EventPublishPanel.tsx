import { Button, Icon, useToast } from "@showme/design-system";
import { useEventPublishing } from "./useEventPublishing";

export interface EventPublishPanelProps {
  eventId: string;
  /** The edit form above has changes that aren't saved yet. */
  hasUnsavedChanges: boolean;
  /** The modal lost its optimistic lock — nothing here may be acted on either. */
  disabled: boolean;
}

/**
 * "Public event page" — the publish control, inside the Event Information edit
 * modal.
 *
 * WHY IT IS NOT A CHECKBOX AMONG THE FIELDS. Every other control in this modal
 * edits a value that is written when the operator presses "Save changes" and
 * thrown away when they press Cancel. Publishing is none of those things: it
 * takes effect the moment it is pressed, it goes through its own route and its
 * own capability (`event.publish`), it writes a line into the event's history
 * that every participant can read — and it puts a page about a real show on the
 * public internet, which is the one action in this modal that a stranger can see
 * the result of. A tick box between "Venue" and "Capacity" would say the
 * opposite of all of that. So it gets its own panel, its own explanation of what
 * a visitor will see, and a button that names the act.
 *
 * WHAT IT PROMISES IS EXACTLY WHAT `serializePublicEvent` RETURNS
 * (`apps/api/src/serialize/public.ts`) — title, date, venue name, doors and show
 * time, and nothing else. The list below is that allowlist written out, so the
 * operator never has to guess whether their budget or their counterparties are
 * on the internet.
 */
export function EventPublishPanel({
  eventId,
  hasUnsavedChanges,
  disabled,
}: EventPublishPanelProps) {
  const toast = useToast();
  const publishing = useEventPublishing(eventId, { hasUnsavedChanges });

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
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--muted)" }}>
            Anyone with this link can see the show and RSVP to it.
          </p>
          <PublicLink url={publishing.publicUrl} onCopy={copyLink} />
          <VisibilityList />
          <div>
            <Button
              variant="ghost"
              onClick={publishing.unpublish}
              disabled={disabled || publishing.isWorking}
            >
              {publishing.isWorking ? "Taking it down…" : "Take the page down"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--muted)" }}>
            Publishing puts a page about this show on the public internet, for anyone with the link
            — no shoWMe account needed. Everyone on the bill sees in the event's history that you
            published it.
          </p>
          <VisibilityList />
          {publishing.blockedReason && <BlockedNotice reason={publishing.blockedReason} />}
          <div>
            <Button
              variant="primary"
              onClick={publishing.publish}
              disabled={disabled || !publishing.canPublish}
            >
              {publishing.isWorking ? "Publishing…" : "Publish this event"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

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
      {published ? "Live" : "Not published"}
    </span>
  );
}

/**
 * The allowlist, in words. It is written positively AND negatively because the
 * question an operator actually has is the second one: an event carries a
 * budget, deals and other people's fees, and "we only publish the poster" is
 * only reassuring if the things left out are named.
 */
function VisibilityList() {
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--muted)" }}>
      <div style={{ color: "var(--text)" }}>Visitors see:</div>
      <div>the event name, the date, the venue name, and the doors / show times.</div>
      <div style={{ marginTop: 6, color: "var(--text)" }}>They never see:</div>
      <div>
        the budget, deals or fees, who is on the bill, participants' contact details, your guest
        list, ticket tiers, capacity, or your notes.
      </div>
    </div>
  );
}

/** The precondition, before the click rather than after it. */
function BlockedNotice({ reason }: { reason: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 9,
        background: "color-mix(in srgb,#F4A046 12%,transparent)",
        border: "1px solid color-mix(in srgb,#F4A046 30%,transparent)",
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

function PublicLink({ url, onCopy }: { url: string; onCopy: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text)",
          background: "var(--elevated)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "8px 11px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {url}
      </a>
      <Button variant="ghost" onClick={onCopy} leftIcon={<Icon name="copy" size={14} />}>
        Copy
      </Button>
    </div>
  );
}
