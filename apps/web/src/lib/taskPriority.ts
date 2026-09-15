import type { Status } from "@showme/design-system";

/**
 * HOW MUCH A TASK MATTERS — Ran's four words, in his order (ClickUp
 * `123qy9rnk29`: *"Urgent, High, Normal, Low"*).
 *
 * One home for the vocabulary, the ranking and the colour, because three screens
 * need them and any two of them disagreeing is a bug nobody would look for: the
 * dialog that sets a tag, the row that draws it, and the Dashboard that sorts by
 * it (`123qy9rnk27`).
 *
 * **Untagged is a real value**, not a missing one. Every task written before the
 * column existed has no tag, and most will keep it — `tasks.priority` is nullable
 * with no default precisely so that "nobody has triaged this" is distinguishable
 * from "somebody judged it ordinary".
 */
export type TaskPriority = "urgent" | "high" | "normal" | "low";

/** Most urgent first — the order Ran wrote them, and the order they sort in. */
export const TASK_PRIORITIES: readonly TaskPriority[] = ["urgent", "high", "normal", "low"];

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

/**
 * The badge hue per tag, borrowed from the status palette rather than inventing a
 * second set of reds and ambers that would drift from it.
 *
 * `normal` and `low` deliberately share the quietest treatment: a tag that means
 * "ordinary" should not compete for attention with one that means "now".
 */
export const TASK_PRIORITY_STATUS: Record<TaskPriority, Status> = {
  urgent: "cancelled",
  high: "pending",
  normal: "task",
  low: "draft",
};

/**
 * Sort key, ascending — most urgent first.
 *
 * **Untagged ranks BELOW `low`**, which is the one judgement call in this file. A
 * job nobody has looked at should not outrank one somebody has explicitly called
 * unimportant; the alternative (untagged in the middle, as if it were "normal")
 * would let an untriaged list quietly outrank a triaged one.
 */
export function taskPriorityRank(priority: string | null | undefined): number {
  const index = TASK_PRIORITIES.indexOf(priority as TaskPriority);
  return index === -1 ? TASK_PRIORITIES.length : index;
}

/**
 * Order tasks the way a person reads a to-do list: most urgent first, then
 * soonest, then oldest.
 *
 * DUE DATE BREAKS THE TIE, and a task with no due date sorts after one that has
 * one at the same priority — "urgent, by Friday" is more actionable than "urgent,
 * someday". `createdAt` is the final tiebreak so the order is total and stable
 * rather than dependent on however the rows arrived.
 */
export function byPriorityThenDue<
  Task extends { priority?: string | null; dueDate?: string | null; createdAt?: string },
>(left: Task, right: Task): number {
  const rank = taskPriorityRank(left.priority) - taskPriorityRank(right.priority);
  if (rank !== 0) return rank;
  const leftDue = left.dueDate ?? "";
  const rightDue = right.dueDate ?? "";
  if (leftDue !== rightDue) {
    if (leftDue === "") return 1;
    if (rightDue === "") return -1;
    return leftDue < rightDue ? -1 : 1;
  }
  return (left.createdAt ?? "").localeCompare(right.createdAt ?? "");
}
