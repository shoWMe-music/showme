import { Button, Card, Input } from "@showme/design-system";
import { type ReactNode, useState } from "react";
import { relativeTime } from "../lib/format";
import { Eyebrow } from "./primitives";

/** One comment on the shared document, as the API returns it. */
export interface ShareComment {
  id: string;
  section: string | null;
  authorName: string | null;
  authorEmail: string | null;
  message: string;
  createdAt: string;
  isYours: boolean;
}

/**
 * One section of the shared document, with the conversation that belongs to it.
 *
 * The section is carried EXPLICITLY — as `settlement_comments.section`, one of the
 * document's own six names. The old app achieved the same effect by prefixing the
 * message text (`"[Agreement] the load-in time is wrong"`), which is a field
 * pretending to be prose: it cannot be filtered on, it cannot be rendered beside
 * the thing it is about, and a recipient who types the prefix themselves is
 * indistinguishable from the client that meant it.
 */
export interface ShareSectionCardProps {
  section: string;
  title: string;
  children: ReactNode;
  comments: ShareComment[];
  canComment: boolean;
  onComment: (message: string) => void;
  isCommenting: boolean;
  /** Rendered under the content — the Approve button, where there is one. */
  action?: ReactNode;
  /**
   * How the composer names this section ("the show", "your settlement"). Its own
   * prop rather than a lowercased `title`, because a heading and a sentence want
   * different words: "Schedule" is the right heading and "the schedule" is the
   * right object of a sentence.
   */
  commentSubject: string;
}

export function ShareSectionCard({
  section,
  title,
  children,
  comments,
  canComment,
  onComment,
  isCommenting,
  action,
  commentSubject,
}: ShareSectionCardProps) {
  const [draft, setDraft] = useState("");
  const mine = comments.filter((comment) => comment.section === section);

  const submit = () => {
    const message = draft.trim();
    if (!message) return;
    onComment(message);
    setDraft("");
  };

  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Eyebrow>{title}</Eyebrow>
      {children}
      {/* The card is a flex COLUMN, so an action dropped straight into it stretches
          edge to edge — the Approve button came out as a full-width orange bar and
          the "Approved" badge as a full-width green one. An act is a control, not a
          banner; this pins it to its own width. */}
      {action && <div style={{ alignSelf: "flex-start" }}>{action}</div>}

      {(mine.length > 0 || canComment) && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            borderTop: "1px solid var(--border)",
            paddingTop: 12,
          }}
        >
          {mine.map((comment) => (
            <div key={comment.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {comment.isYours ? "You" : (comment.authorName ?? comment.authorEmail ?? "shoWMe")}
                {" · "}
                {relativeTime(comment.createdAt)}
              </span>
              <span style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.5 }}>
                {comment.message}
              </span>
            </div>
          ))}

          {/* A single-line `Input`, because the design system has no textarea and
              `CommentThread` — the app's existing conversation surface — composes
              its composer exactly this way. A settlement remark can be a
              paragraph, so a multi-line field is a real gap; inventing one here
              would be inventing it in the wrong place. */}
          {canComment && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <Input
                  value={draft}
                  placeholder={`Comment on ${commentSubject}…`}
                  aria-label={`Comment on ${commentSubject}`}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submit();
                  }}
                />
              </div>
              <Button variant="secondary" onClick={submit} disabled={isCommenting || !draft.trim()}>
                Post
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
