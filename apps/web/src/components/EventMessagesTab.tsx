import { Avatar, type AvatarTone, Badge, Card, Select } from "@showme/design-system";
import { relativeTime } from "../lib/format";
import { CommentThread } from "./CommentThread";
import styles from "./MessageSurface.module.css";
import { ErrorState, LoadingState } from "./states";
import {
  type MessageThread,
  type MessagesTabParty,
  useEventMessageThreads,
} from "./useEventMessageThreads";
import { useMessageRailMode } from "./useMessageSurface";

export type { MessagesTabParty } from "./useEventMessageThreads";

/**
 * Messages — one thread per party, not one thread per event.
 *
 * The operator is the hub: they meet each performer, and each crew person, on that
 * party's own thread, and keep their own back office besides. Two performers on the
 * same bill never share one (story.md — each person sees only their slice).
 *
 * The rail says WHO IS IN each thread, in words, from the server's own reader list.
 * That is deliberate: the operator is in most of these threads, and a thread that
 * looks private but is not is worse than no thread. So nothing here is labelled
 * "private" — it is labelled with the people who can read it.
 *
 * Both halves live on ONE surface. Choosing a conversation is part of being in the
 * conversation, so the chooser sits inside the same container as the messages,
 * divided from them by a hairline rather than by a gap.
 */
export function EventMessagesTab({
  eventId,
  roster,
}: {
  eventId: string;
  /** Participants by id, for naming a message's sender. */
  roster: MessagesTabParty[];
}) {
  const { threads, messages, comments, selected, selectKey, draft, setDraft, post } =
    useEventMessageThreads(eventId, roster);
  const { containerRef, isNarrow } = useMessageRailMode();

  if (threads.isPending) return <LoadingState label="Loading messages" />;
  if (threads.isError) return <ErrorState error={threads.error} title="Couldn't load messages" />;

  // There is deliberately NO "no conversations at all" state here. It cannot
  // happen: the event room is unconditional for anyone who passed `event.view`
  // (`visibleThreads` in apps/api/src/lib/message-threads.ts), so a caller who
  // can see this tab always has at least one thread. A conversation with no
  // MESSAGES yet is the empty state that is real, and it belongs to the thread.
  const items = threads.data ?? [];

  return (
    <div ref={containerRef}>
      <Card
        padding="none"
        className={[styles.surface, isNarrow && styles.surfaceNarrow].filter(Boolean).join(" ")}
      >
        {isNarrow ? (
          <ThreadSelector threads={items} selectedKey={selected?.key} onSelect={selectKey} />
        ) : (
          <ThreadRail threads={items} selectedKey={selected?.key} onSelect={selectKey} />
        )}

        {/* Keyed on the thread: switching remounts the pane, which is what plays
            the cross-fade and what re-opens the new conversation at its newest
            message. The fade is opacity only and suspends nothing, so the
            composer takes a keystroke on the first frame. */}
        <section
          key={selected?.key ?? "none"}
          aria-label="Conversation"
          className={[styles.conversation, styles.conversationEnter].join(" ")}
        >
          {selected && <ConversationHeader thread={selected} />}
          {messages.isPending && selected ? (
            <div className={styles.conversationFill}>
              <LoadingState label="Loading thread" />
            </div>
          ) : messages.isError ? (
            <div className={styles.conversationFill}>
              <ErrorState error={messages.error} title="Couldn't load this thread" />
            </div>
          ) : (
            <CommentThread
              comments={comments}
              draft={draft}
              onDraftChange={setDraft}
              onSubmit={() => draft.trim() && post.mutate(draft.trim())}
              readOnly={!selected?.canPost}
              isSubmitting={post.isPending}
              placeholder={`Message ${selected?.title ?? ""}…`}
              emptyDescription={
                selected?.canPost
                  ? `Nothing here yet. Anything you write is read by ${readerSummary(selected)}.`
                  : "Nothing has been said in this conversation yet."
              }
            />
          )}
        </section>
      </Card>
    </div>
  );
}

/** The rail: every conversation, one row each, scrolling on its own. */
function ThreadRail({
  threads,
  selectedKey,
  onSelect,
}: {
  threads: MessageThread[];
  selectedKey: string | undefined;
  onSelect: (key: string) => void;
}) {
  return (
    <nav aria-label="Message threads" className={styles.rail}>
      {threads.map((thread) => (
        <ThreadRow
          key={thread.key}
          thread={thread}
          active={thread.key === selectedKey}
          onSelect={() => onSelect(thread.key)}
        />
      ))}
    </nav>
  );
}

/**
 * The rail, once there is no room for a rail. One control, one line tall — the
 * conversation keeps every other pixel, which is the half you came to read.
 */
function ThreadSelector({
  threads,
  selectedKey,
  onSelect,
}: {
  threads: MessageThread[];
  selectedKey: string | undefined;
  onSelect: (key: string) => void;
}) {
  return (
    <div className={styles.selectorBar}>
      <Select
        aria-label="Conversation"
        value={selectedKey ?? ""}
        onChange={onSelect}
        options={threads.map((thread) => ({ value: thread.key, label: thread.title }))}
        searchable={threads.length > 8}
      />
    </div>
  );
}

/** One thread in the rail: who it is with, who else can read it, how busy it is. */
function ThreadRow({
  thread,
  active,
  onSelect,
}: {
  thread: MessageThread;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={[styles.threadRow, active && styles.threadRowActive].filter(Boolean).join(" ")}
    >
      <Avatar
        initials={railInitials(thread)}
        tone={scopeTone(thread.scope)}
        shape="circle"
        size={32}
      />
      <span className={styles.threadText}>
        <span className={styles.threadTitle}>
          <span className={styles.threadName}>{thread.title}</span>
          {thread.messageCount > 0 && (
            <span className={styles.threadMeta}>{relativeTime(thread.lastMessageAt ?? "")}</span>
          )}
        </span>
        <span className={styles.threadReaders}>{readerSummary(thread)}</span>
      </span>
    </button>
  );
}

/** The header above the open thread — the reader list again, in full, never elided. */
function ConversationHeader({ thread }: { thread: MessageThread }) {
  return (
    <header className={styles.conversationHeader}>
      <div className={styles.conversationTitleRow}>
        <h3 className={styles.conversationTitle}>{thread.title}</h3>
        <Badge status={thread.scope === "operators" ? "pending" : "confirmed"} dot>
          {scopeLabel(thread.scope)}
        </Badge>
      </div>
      <p className={styles.conversationReaders}>Read by {readerSummary(thread)}.</p>
    </header>
  );
}

/**
 * A party thread is a PERSON, so it gets a person's two initials. The event room
 * and the back office are PLACES — "Operators only" as "OO" reads like someone's
 * name — so they get one letter.
 */
function railInitials(thread: MessageThread): string {
  const words = thread.title.split(/\s+/).filter(Boolean);
  const wanted = thread.scope === "party" ? 2 : 1;
  return (
    words
      .slice(0, wanted)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function readerSummary(thread: MessageThread): string {
  if (thread.scope === "all") return "everyone on this event";
  const names = thread.readers.map((reader) => reader.name);
  if (names.length === 0) return "nobody yet";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
}

function scopeLabel(scope: MessageThread["scope"]): string {
  if (scope === "all") return "Everyone";
  if (scope === "operators") return "Operators only";
  return "Party thread";
}

/** The rail's avatar carries the scope as colour, so the glyph the row used to
 * spend a column on is not lost when the row gains a face. */
function scopeTone(scope: MessageThread["scope"]): AvatarTone {
  if (scope === "all") return "blue";
  if (scope === "operators") return "amber";
  return "brand";
}
