import { Badge } from "@showme/design-system";
import { TASK_PRIORITY_LABEL, TASK_PRIORITY_STATUS, type TaskPriority } from "../lib/taskPriority";

/**
 * A task's priority, where a task is listed (ClickUp `123qy9rnk29`).
 *
 * One component rather than the same badge written into both row renderers — the
 * Tasks page and the board draw a task differently but must not disagree about
 * what "Urgent" looks like.
 *
 * **Renders nothing for an untagged task**, which is most of them. A "No
 * priority" chip on every row would be noise on exactly the rows that have
 * nothing to say, and the absence already reads as untagged.
 */
export function TaskPriorityBadge({ priority }: { priority: string | null | undefined }) {
  if (!priority || !(priority in TASK_PRIORITY_LABEL)) return null;
  const tag = priority as TaskPriority;
  return <Badge status={TASK_PRIORITY_STATUS[tag]}>{TASK_PRIORITY_LABEL[tag]}</Badge>;
}
