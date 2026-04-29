import { describe, it, expect } from "vitest";
import { buildTodoShareUrl } from "./TodoTab";

// ────────────────────────────────────────────────────────────────────────────
// Bug 3: TodoTab generates correct share-link route
//
// The share link must point to /shared/budget/$token, which is the route
// registered in router.tsx and handled by SharedBudgetPage. SharedBudgetPage
// dispatches on the payload's `type === "todo-schedule"` to render the task
// schedule view. The share token is persisted by `insertShareTokenRow`, which
// writes to the same `PUBLIC_SHARES` Firestore doc that
// `fetchShareTokenPartiesForBudget` reads from.
// ────────────────────────────────────────────────────────────────────────────

describe("buildTodoShareUrl", () => {
  it("builds the URL using the registered /shared/budget/$token route", () => {
    const url = buildTodoShareUrl("https://app.example.com", "abc-123");
    expect(url).toBe("https://app.example.com/shared/budget/abc-123");
  });

  it("does not point at a non-existent /shared/todo/ route", () => {
    const url = buildTodoShareUrl("https://app.example.com", "tok");
    expect(url).not.toContain("/shared/todo/");
    expect(url).not.toContain("/review/");
  });

  it("preserves the origin verbatim", () => {
    expect(buildTodoShareUrl("http://localhost:5173", "t1"))
      .toBe("http://localhost:5173/shared/budget/t1");
  });

  it("matches the /shared/budget/$token pattern", () => {
    const url = buildTodoShareUrl("https://x.com", "uuid-token-xyz");
    expect(url).toMatch(/\/shared\/budget\/[a-zA-Z0-9-]+$/);
  });
});
