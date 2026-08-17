import { Avatar, type AvatarTone, Button, Card, Input } from "@showme/design-system";
import { Eyebrow } from "./primitives";

/** A threaded comment / message list with a composer (§6b comments, §3b
 * Messages). Presentational: the screen owns the draft value and submit.
 * Realtime updates arrive as new `comments` from the screen. */
export interface ThreadComment {
  id: string;
  author: string;
  initials: string;
  tone?: AvatarTone;
  /** Pre-formatted relative time, e.g. "2d ago". */
  time: string;
  body: string;
}

export interface CommentThreadProps {
  comments: ThreadComment[];
  eyebrow?: string;
  /** Controlled composer value. */
  draft?: string;
  placeholder?: string;
  onDraftChange?: (value: string) => void;
  onSubmit?: () => void;
  /** Hide the composer for read-only threads. */
  readOnly?: boolean;
  submitLabel?: string;
}

export function CommentThread({
  comments,
  eyebrow,
  draft = "",
  placeholder = "Write a comment…",
  onDraftChange,
  onSubmit,
  readOnly = false,
  submitLabel = "Post",
}: CommentThreadProps) {
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {comments.map((comment) => (
          <div key={comment.id} style={{ display: "flex", gap: 10 }}>
            <Avatar initials={comment.initials} tone={comment.tone ?? "brand"} size={30} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ color: "var(--text)", fontWeight: 600, fontSize: 13 }}>
                  {comment.author}
                </span>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>{comment.time}</span>
              </div>
              <p style={{ margin: "2px 0 0", color: "var(--text)", fontSize: 14, lineHeight: 1.5 }}>
                {comment.body}
              </p>
            </div>
          </div>
        ))}
      </div>

      {!readOnly && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <Input
              value={draft}
              placeholder={placeholder}
              onChange={(event) => onDraftChange?.(event.target.value)}
            />
          </div>
          <Button variant="primary" onClick={onSubmit}>
            {submitLabel}
          </Button>
        </div>
      )}
    </Card>
  );
}
