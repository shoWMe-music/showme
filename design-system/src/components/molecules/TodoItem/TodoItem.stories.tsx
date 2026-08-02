import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { TodoItem } from "./TodoItem";

const meta = {
  title: "Molecules/TodoItem",
  component: TodoItem,
  tags: ["autodocs"],
  args: { text: "Send Nils Frahm the schedule", done: false },
} satisfies Meta<typeof TodoItem>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => {
    const [done, setDone] = useState(args.done);
    return <div style={{ width: 420 }}><TodoItem {...args} done={done} onToggle={setDone} onDelete={() => {}} /></div>;
  },
};

interface Task { id: string; text: string; done: boolean; }
const INITIAL: Task[] = [
  { id: "1", text: "Confirm the date with the venue", done: true },
  { id: "2", text: "Send Nils Frahm the schedule", done: false },
  { id: "3", text: "Finalize the door split", done: false },
  { id: "4", text: "Book the backline", done: true },
  { id: "5", text: "Chase the signed agreement", done: false },
];

/** The event "To Do" list — a card with an active count and toggle/delete. */
export const TodoList: Story = {
  render: () => {
    const [tasks, setTasks] = useState(INITIAL);
    const active = tasks.filter((task) => !task.done).length;
    const toggle = (id: string, done: boolean) => setTasks((list) => list.map((task) => (task.id === id ? { ...task, done } : task)));
    const remove = (id: string) => setTasks((list) => list.filter((task) => task.id !== id));

    return (
      <div style={{ width: 460, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 18, boxShadow: "var(--shadow)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px" }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 18, margin: 0, color: "var(--text)" }}>To Do</h3>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, padding: "3px 10px", borderRadius: 999, background: "var(--elevated)", color: "var(--muted)" }}>
            {active} active
          </span>
        </div>
        {tasks.map((task) => (
          <TodoItem key={task.id} text={task.text} done={task.done} onToggle={(done) => toggle(task.id, done)} onDelete={() => remove(task.id)} />
        ))}
      </div>
    );
  },
};
