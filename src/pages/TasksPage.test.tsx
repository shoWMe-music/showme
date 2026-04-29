import { describe, it, expect } from "vitest";
import { buildNewTodos } from "./TasksPage";

// ────────────────────────────────────────────────────────────────────────────
// A3: Tasks page Create Task — multi-assignee handling
// "Allow assigning one task/note/schedule to multiple people"
// ────────────────────────────────────────────────────────────────────────────

describe("buildNewTodos (A3)", () => {
  it("returns one todo per assignee when multiple are selected", () => {
    const todos = buildNewTodos({
      title: "Confirm rider",
      assignees: ["Alice", "Bob", "Charlie"],
      now: 1_700_000_000_000,
    });
    expect(todos).toHaveLength(3);
    expect(todos.map(t => t.assignee)).toEqual(["Alice", "Bob", "Charlie"]);
    // All carry the same title and unique ids
    expect(new Set(todos.map(t => t.title))).toEqual(new Set(["Confirm rider"]));
    expect(new Set(todos.map(t => t.id)).size).toBe(3);
  });

  it("returns a single unassigned todo when no assignees are selected", () => {
    const todos = buildNewTodos({
      title: "Misc todo",
      assignees: [],
      now: 1_700_000_000_000,
    });
    expect(todos).toHaveLength(1);
    expect(todos[0].assignee).toBeUndefined();
  });

  it("returns a single assigned todo when one assignee is selected (preserves existing shape)", () => {
    const todos = buildNewTodos({
      title: "Just one",
      assignees: ["Alice"],
      now: 1_700_000_000_000,
    });
    expect(todos).toHaveLength(1);
    expect(todos[0].assignee).toBe("Alice");
  });

  it("propagates dueDate to every produced todo", () => {
    const todos = buildNewTodos({
      title: "Send invoice",
      assignees: ["Alice", "Bob"],
      dueDate: "2026-05-01",
      now: 1_700_000_000_000,
    });
    expect(todos.every(t => t.dueDate === "2026-05-01")).toBe(true);
  });

  it("trims the title and skips creation when title is empty/whitespace", () => {
    expect(buildNewTodos({ title: "   ", assignees: [] })).toEqual([]);
    expect(buildNewTodos({ title: "", assignees: ["Alice"] })).toEqual([]);
    const trimmed = buildNewTodos({ title: "  hello  ", assignees: ["A"], now: 1 });
    expect(trimmed[0].title).toBe("hello");
  });
});
