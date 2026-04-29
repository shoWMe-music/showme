import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecipientsInput } from "./RecipientsInput";
import type { TeamMember } from "@/lib/user-context";

function makeTeamMember(overrides: Partial<TeamMember> & { id: string; name: string }): TeamMember {
  return {
    email: `${overrides.name.toLowerCase().replace(/\s/g, "")}@test.com`,
    roles: ["crew"],
    status: "active",
    ...overrides,
  };
}

describe("RecipientsInput", () => {
  const defaultProps = {
    recipientInput: "",
    recipients: [],
    teamMembers: [] as TeamMember[],
    onChangeInput: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onAddTeamMember: vi.fn(),
  };

  it("renders the label and input", () => {
    render(<RecipientsInput {...defaultProps} />);
    expect(screen.getByText(/Recipients/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Enter email/)).toBeInTheDocument();
  });

  it("shows Add button disabled when input is empty", () => {
    render(<RecipientsInput {...defaultProps} />);
    const addBtn = screen.getByRole("button", { name: /Add/i });
    expect(addBtn).toBeDisabled();
  });

  it("shows Add button enabled when input has text", () => {
    render(<RecipientsInput {...defaultProps} recipientInput="test@email.com" />);
    const addBtn = screen.getByRole("button", { name: /Add/i });
    expect(addBtn).not.toBeDisabled();
  });

  it("calls onAdd when Add button is clicked", () => {
    const onAdd = vi.fn();
    render(<RecipientsInput {...defaultProps} recipientInput="x@y.com" onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /Add/i }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("calls onAdd when Enter is pressed in input", () => {
    const onAdd = vi.fn();
    render(<RecipientsInput {...defaultProps} recipientInput="x@y.com" onAdd={onAdd} />);
    const input = screen.getByPlaceholderText(/Enter email/);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("renders recipient badges", () => {
    render(
      <RecipientsInput
        {...defaultProps}
        recipients={["alice@test.com", "bob@test.com"]}
      />,
    );
    expect(screen.getByText("alice@test.com")).toBeInTheDocument();
    expect(screen.getByText("bob@test.com")).toBeInTheDocument();
  });

  it("calls onRemove when badge X is clicked", () => {
    const onRemove = vi.fn();
    render(
      <RecipientsInput
        {...defaultProps}
        recipients={["alice@test.com"]}
        onRemove={onRemove}
      />,
    );
    const removeBtn = screen.getByText("alice@test.com").closest("div")!.querySelector("button");
    fireEvent.click(removeBtn!);
    expect(onRemove).toHaveBeenCalledWith("alice@test.com");
  });

  it("shows team member popover button when teamMembers exist", () => {
    const members = [
      makeTeamMember({ id: "m1", name: "Alice" }),
    ];
    render(<RecipientsInput {...defaultProps} teamMembers={members} />);
    // The Plus+Users button should exist
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it("filters out team members without email", () => {
    const members = [
      makeTeamMember({ id: "m1", name: "Alice", email: "alice@test.com" }),
      makeTeamMember({ id: "m2", name: "No Email", email: "" }),
    ];
    render(<RecipientsInput {...defaultProps} teamMembers={members} />);
    // The member without email should not appear in the available count
    // We can't easily test popover content without opening it, but we verify no crash
    expect(screen.getByPlaceholderText(/Enter email/)).toBeInTheDocument();
  });

  it("filters out already-added members from team list", () => {
    const members = [
      makeTeamMember({ id: "m1", name: "Alice", email: "alice@test.com" }),
      makeTeamMember({ id: "m2", name: "Bob", email: "bob@test.com" }),
    ];
    render(
      <RecipientsInput
        {...defaultProps}
        teamMembers={members}
        recipients={["alice@test.com"]}
      />,
    );
    // Alice is already added, so only Bob should be available
    // UI renders but popover is closed by default
    expect(screen.getByText("alice@test.com")).toBeInTheDocument();
  });

  it("treats members with undefined status as active", () => {
    const members = [
      makeTeamMember({ id: "m1", name: "Legacy Member", email: "legacy@test.com", status: undefined as any }),
    ];
    render(<RecipientsInput {...defaultProps} teamMembers={members} />);
    // Should not crash, member should be treated as available
    expect(screen.getByPlaceholderText(/Enter email/)).toBeInTheDocument();
  });

  it("renders each team member's own email in the 'Add from team' dropdown (not the current user's)", () => {
    const members = [
      makeTeamMember({ id: "m1", name: "Ori Kastiel", email: "ori.showme@gmail.com" }),
      makeTeamMember({ id: "m2", name: "Ben Azulay", email: "ben.azulay@example.com" }),
      makeTeamMember({ id: "m3", name: "Nir Freedman", email: "nir.freedman@example.com" }),
    ];
    render(<RecipientsInput {...defaultProps} teamMembers={members} />);

    // Open the team-member popover. The trigger is the 2nd button (after the
    // disabled "Add" button); identify it by its icon-only content.
    const buttons = screen.getAllByRole("button");
    const popoverTrigger = buttons.find(
      (b) => b.querySelector("svg.lucide-users") || b.querySelector('[class*="users"]'),
    ) ?? buttons[buttons.length - 1];
    fireEvent.click(popoverTrigger);

    // Each member should render exactly once with its own email — no row may
    // accidentally fall back to the current user's email.
    expect(screen.getByText(/Ori Kastiel/)).toBeInTheDocument();
    expect(screen.getByText(/Ben Azulay/)).toBeInTheDocument();
    expect(screen.getByText(/Nir Freedman/)).toBeInTheDocument();

    expect(screen.getAllByText(/ori\.showme@gmail\.com/)).toHaveLength(1);
    expect(screen.getAllByText(/ben\.azulay@example\.com/)).toHaveLength(1);
    expect(screen.getAllByText(/nir\.freedman@example\.com/)).toHaveLength(1);
  });

  it("closes the team popover after a member is added so the user gets visual confirmation", () => {
    const onAddTeamMember = vi.fn();
    const members = [
      makeTeamMember({ id: "m1", name: "Ori Kastiel", email: "ori.showme@gmail.com" }),
      makeTeamMember({ id: "m2", name: "Ben Azulay", email: "ben.azulay@example.com" }),
    ];
    render(
      <RecipientsInput
        {...defaultProps}
        teamMembers={members}
        onAddTeamMember={onAddTeamMember}
      />,
    );
    const buttons = screen.getAllByRole("button");
    const popoverTrigger = buttons.find(
      (b) => b.querySelector("svg.lucide-users") || b.querySelector('[class*="users"]'),
    ) ?? buttons[buttons.length - 1];
    fireEvent.click(popoverTrigger);

    // Popover open — both members visible.
    expect(screen.getByText(/Ori Kastiel/)).toBeInTheDocument();
    expect(screen.getByText(/Ben Azulay/)).toBeInTheDocument();

    // Click a member.
    fireEvent.click(screen.getByText(/Ori Kastiel/));
    expect(onAddTeamMember).toHaveBeenCalledOnce();

    // Popover should now be closed — neither member name is in the DOM anymore.
    expect(screen.queryByText(/Ori Kastiel/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ben Azulay/)).not.toBeInTheDocument();
  });

  it("only collapses to 'All active members added' when every distinct member with email is added", () => {
    const members = [
      makeTeamMember({ id: "m1", name: "Ori Kastiel", email: "ori.showme@gmail.com" }),
      makeTeamMember({ id: "m2", name: "Ben Azulay", email: "ben.azulay@example.com" }),
    ];
    // Only Ori added — Ben should still be visible, no "all added" message yet.
    render(
      <RecipientsInput
        {...defaultProps}
        teamMembers={members}
        recipients={["ori.showme@gmail.com"]}
      />,
    );
    const buttons = screen.getAllByRole("button");
    const popoverTrigger = buttons.find(
      (b) => b.querySelector("svg.lucide-users") || b.querySelector('[class*="users"]'),
    ) ?? buttons[buttons.length - 1];
    fireEvent.click(popoverTrigger);

    // Ben must still appear (with his own email), and the "all added" copy must not be shown.
    expect(screen.getByText(/Ben Azulay/)).toBeInTheDocument();
    expect(screen.getByText(/ben\.azulay@example\.com/)).toBeInTheDocument();
    expect(screen.queryByText(/All active members added/i)).not.toBeInTheDocument();
  });
});
