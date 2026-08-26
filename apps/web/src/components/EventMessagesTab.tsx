import { Badge, Icon } from "@showme/design-system";
import { relativeTime } from "../lib/format";
import { CommentThread, type ThreadComment } from "./CommentThread";
import { ErrorState, LoadingState } from "./states";
import { type MessageThread, useEventMessageThreads } from "./useEventMessageThreads";

export interface MessagesTabParty {
  id: string;
  name: string;
}

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
 */
export function EventMessagesTab({
  eventId,
  roster,
}: {
  eventId: string;
  /** Participants by id, for naming a message's sender. */
  roster: MessagesTabParty[];
}) {
  const { threads, messages, selected, selectKey, draft, setDraft, post } =
    useEventMessageThreads(eventId);

  if (threads.isPending) return <LoadingState label="Loading messages" />;
  if (threads.isError) return <ErrorState error={threads.error} title="Couldn't load messages" />;

  const items = threads.data ?? [];

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <nav
        aria-label="Message threads"
        style={{ flex: "1 1 240px", minWidth: 240, display: "grid", gap: 8 }}
      >
        {items.map((thread) => (
          <ThreadRow
            key={thread.key}
            thread={thread}
            active={thread.key === selected?.key}
            onSelect={() => selectKey(thread.key)}
          />
        ))}
      </nav>

      <div style={{ flex: "3 1 380px", minWidth: 300 }}>
        {selected && <ThreadPane thread={selected} />}
        {messages.isPending && selected ? (
          <LoadingState label="Loading thread" />
        ) : messages.isError ? (
          <ErrorState error={messages.error} title="Couldn't load this thread" />
        ) : (
          <CommentThread
            comments={toComments(messages.data ?? [], roster)}
            draft={draft}
            onDraftChange={setDraft}
            onSubmit={() => draft.trim() && post.mutate(draft.trim())}
            readOnly={!selected?.canPost}
            placeholder={`Message ${selected?.title ?? ""}…`}
            submitLabel={post.isPending ? "Sending…" : "Send"}
          />
        )}
      </div>
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
      aria-current={active}
      style={{
        textAlign: "left",
        display: "flex",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 12,
        border: active ? "1px solid #EE5746" : "1px solid var(--border)",
        background: active ? "color-mix(in srgb,#EE5746 8%,transparent)" : "var(--card)",
        color: "var(--text)",
        cursor: "pointer",
      }}
    >
      <span style={{ color: active ? "#EE5746" : "var(--muted)", flexShrink: 0, marginTop: 1 }}>
        <Icon name={scopeIcon(thread.scope)} size={16} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{thread.title}</span>
          {thread.messageCount > 0 && (
            <span style={{ color: "var(--dim)", fontSize: 11.5 }}>
              {thread.messageCount} · {relativeTime(thread.lastMessageAt ?? "")}
            </span>
          )}
        </span>
        <span
          style={{
            display: "block",
            color: "var(--muted)",
            fontSize: 12,
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {readerSummary(thread)}
        </span>
      </span>
    </button>
  );
}

/** The header above the open thread — the reader list again, in full, never elided. */
function ThreadPane({ thread }: { thread: MessageThread }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: 17,
            margin: 0,
            color: "var(--text)",
          }}
        >
          {thread.title}
        </h3>
        <Badge status={thread.scope === "operators" ? "pending" : "confirmed"} dot>
          {scopeLabel(thread.scope)}
        </Badge>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "4px 0 0" }}>
        Read by {readerSummary(thread)}.
      </p>
    </div>
  );
}

function toComments(
  messages: { id: string; body: string; createdAt: string; senderParticipantId: string | null }[],
  roster: MessagesTabParty[],
): ThreadComment[] {
  return messages.map((message) => {
    const author =
      roster.find((party) => party.id === message.senderParticipantId)?.name ?? "Member";
    return {
      id: message.id,
      author,
      initials: initials(author),
      time: relativeTime(message.createdAt),
      body: message.body,
    };
  });
}

function initials(label: string): string {
  return (
    label
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
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

function scopeIcon(scope: MessageThread["scope"]): "users" | "settings" | "mail" {
  if (scope === "all") return "users";
  if (scope === "operators") return "settings";
  return "mail";
}
