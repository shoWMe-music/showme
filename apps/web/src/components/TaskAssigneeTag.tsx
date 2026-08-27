import { Icon } from "@showme/design-system";

/**
 * "Who owes this" on a task row — the assignee's name beside a person glyph.
 *
 * One component for the three surfaces that list the same tasks (the Tasks list,
 * its board cards, and the event workspace's To Do tab), for the reason the due
 * date has one formatter: a task assigned to Nina must not read as three
 * different things depending on which screen you opened.
 *
 * Renders nothing when nobody is assigned — an empty slot says "unassigned"
 * more honestly than the word does, and every row would otherwise carry it.
 */
export function TaskAssigneeTag({
  name,
  fontSize = 12,
}: {
  name: string | null | undefined;
  /** The row's own scale — the board's cards run slightly smaller than the list. */
  fontSize?: number;
}) {
  if (!name) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-mono)",
        fontSize,
        color: "var(--muted)",
      }}
    >
      <Icon name="user" size={fontSize + 1} />
      {name}
    </span>
  );
}
