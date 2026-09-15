import { describe, expect, it } from "vitest";
import { TASK_PRIORITIES, byPriorityThenDue, taskPriorityRank } from "./taskPriority";

/**
 * The ranking rule behind ClickUp `123qy9rnk29` and the Dashboard preview that
 * needs it (`123qy9rnk27`).
 *
 * Worth asserting rather than eyeballing: a wrong order does not throw, it just
 * puts the wrong five tasks in front of somebody — which reads as the feature
 * working.
 */
describe("taskPriorityRank", () => {
  it("ranks Ran's four words in his order, most urgent first", () => {
    const ranks = TASK_PRIORITIES.map(taskPriorityRank);
    expect(ranks).toEqual([0, 1, 2, 3]);
  });

  it("ranks an UNTAGGED task below `low`", () => {
    // The one judgement call in the file: a job nobody has triaged must not
    // outrank one somebody explicitly called unimportant. Putting untagged in the
    // middle (as if it were "normal") would let an untriaged list outrank a
    // triaged one.
    expect(taskPriorityRank(null)).toBeGreaterThan(taskPriorityRank("low"));
    expect(taskPriorityRank(undefined)).toBeGreaterThan(taskPriorityRank("low"));
    expect(taskPriorityRank("nonsense")).toBeGreaterThan(taskPriorityRank("low"));
  });
});

describe("byPriorityThenDue", () => {
  const sorted = (tasks: { title: string; priority?: string | null; dueDate?: string | null }[]) =>
    [...tasks].sort(byPriorityThenDue).map((task) => task.title);

  it("puts the most urgent first and the untagged last", () => {
    expect(
      sorted([
        { title: "untagged", priority: null },
        { title: "low", priority: "low" },
        { title: "urgent", priority: "urgent" },
        { title: "normal", priority: "normal" },
        { title: "high", priority: "high" },
      ]),
    ).toEqual(["urgent", "high", "normal", "low", "untagged"]);
  });

  it("breaks a tie on the due date, soonest first", () => {
    expect(
      sorted([
        { title: "friday", priority: "urgent", dueDate: "2026-09-18" },
        { title: "monday", priority: "urgent", dueDate: "2026-09-14" },
      ]),
    ).toEqual(["monday", "friday"]);
  });

  it("sorts an undated task AFTER a dated one of the same priority", () => {
    // "Urgent, by Friday" is more actionable than "urgent, someday".
    expect(
      sorted([
        { title: "someday", priority: "urgent", dueDate: null },
        { title: "friday", priority: "urgent", dueDate: "2026-09-18" },
      ]),
    ).toEqual(["friday", "someday"]);
  });

  it("never lets a due date outrank a priority", () => {
    // The failure mode worth pinning: sorting by date first would put a low task
    // due tomorrow above an urgent one due next month.
    expect(
      sorted([
        { title: "low-tomorrow", priority: "low", dueDate: "2026-09-16" },
        { title: "urgent-next-month", priority: "urgent", dueDate: "2026-10-16" },
      ]),
    ).toEqual(["urgent-next-month", "low-tomorrow"]);
  });
});
