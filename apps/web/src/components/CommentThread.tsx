import { Avatar, type AvatarTone, Button, EmptyState, Icon, Input } from "@showme/design-system";
import styles from "./MessageSurface.module.css";
import { type MessageDay, useMessageAutoScroll, useMessageDays } from "./useMessageSurface";

/** A conversation: messages that scroll, and a composer that does not (§6b
 * comments, §3b Messages). Presentational — the screen owns the draft value,
 * the submit and who each message is from. Realtime updates arrive as new
 * `comments` from the screen. */
export interface ThreadComment {
  id: string;
  author: string;
  initials: string;
  tone?: AvatarTone;
  /** Raw ISO timestamp — what the day dividers are grouped on. */
  createdAt: string;
  /** Pre-formatted clock time, e.g. "14:32". The day is on the divider above. */
  time: string;
  body: string;
  /** Written by the person reading this. Decides which side it sits on. */
  isOwn?: boolean;
}

export interface CommentThreadProps {
  comments: ThreadComment[];
  /** Controlled composer value. */
  draft?: string;
  placeholder?: string;
  onDraftChange?: (value: string) => void;
  onSubmit?: () => void;
  /** Hide the composer for read-only threads. */
  readOnly?: boolean;
  /** The submit is in flight: the button says so and refuses a second press. */
  isSubmitting?: boolean;
  submitLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function CommentThread({
  comments,
  draft = "",
  placeholder = "Write a message…",
  onDraftChange,
  onSubmit,
  readOnly = false,
  isSubmitting = false,
  submitLabel = "Send",
  emptyTitle = "No messages yet",
  emptyDescription,
}: CommentThreadProps) {
  const days = useMessageDays(comments);
  const { scrollRef, onScroll } = useMessageAutoScroll(comments.length);
  const canSubmit = draft.trim().length > 0 && !isSubmitting;

  // No Card of its own. The thread is the CONTENTS of a conversation surface,
  // not the surface — the caller owns that, so a thread can sit inside a chat
  // window, a share document or a settlement panel without stacking a second
  // border and a second padding inside the first. What it does require is a
  // bounded parent: the composer stays put only because the messages above it
  // are the one part with somewhere to scroll.
  return (
    <div className={styles.thread}>
      <div className={styles.scroll} ref={scrollRef} onScroll={onScroll}>
        {comments.length === 0 ? (
          <div className={styles.emptyThread}>
            <EmptyState
              icon={<Icon name="mail" />}
              title={emptyTitle}
              description={emptyDescription}
            />
          </div>
        ) : (
          <div className={styles.scrollInner}>
            {days.map((day) => (
              <MessageDayGroup key={day.key} day={day} />
            ))}
          </div>
        )}
      </div>

      {!readOnly && (
        <div className={styles.composer}>
          <div className={styles.composerField}>
            <Input
              value={draft}
              placeholder={placeholder}
              aria-label={placeholder}
              onChange={(event) => onDraftChange?.(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                event.preventDefault();
                if (canSubmit) onSubmit?.();
              }}
            />
          </div>
          <Button
            variant="primary"
            disabled={!canSubmit}
            onClick={() => onSubmit?.()}
            rightIcon={<Icon name="arrow-right" size={14} />}
          >
            {isSubmitting ? "Sending…" : submitLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

/** One calendar day: the centred date chip, then that day's messages. */
function MessageDayGroup({ day }: { day: MessageDay }) {
  return (
    <div className={styles.day}>
      {day.label && (
        <div className={styles.dayDivider}>
          <span className={styles.dayChip}>{day.label}</span>
        </div>
      )}
      {day.comments.map((comment) => (
        <MessageBubble key={comment.id} comment={comment} />
      ))}
    </div>
  );
}

/**
 * One message. The other party's on the left with their face beside it, yours on
 * the right with none — in a party-scoped thread "who said this" is the thing a
 * reader scans for, and a side answers it before a name has to be read.
 */
function MessageBubble({ comment }: { comment: ThreadComment }) {
  const rowClass = [styles.message, comment.isOwn && styles.messageOwn].filter(Boolean).join(" ");
  const bubbleClass = [styles.bubble, comment.isOwn ? styles.bubbleOwn : styles.bubbleOther]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={rowClass}>
      {!comment.isOwn && (
        <Avatar
          initials={comment.initials}
          tone={comment.tone ?? "brand"}
          shape="circle"
          size={30}
        />
      )}
      <div className={styles.bubbleColumn}>
        <div className={bubbleClass}>{comment.body}</div>
        <div className={styles.messageMeta}>
          <span className={styles.messageAuthor}>{comment.isOwn ? "You" : comment.author}</span>
          <span>{comment.time}</span>
        </div>
      </div>
    </div>
  );
}
