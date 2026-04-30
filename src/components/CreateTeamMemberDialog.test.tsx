import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockAddTeamMember = vi.fn();
const mockAddMemberToProfile = vi.fn();
const mockSaveProfile = vi.fn();
const mockUseUser = vi.fn();
const mockUseAuth = vi.fn();

vi.mock("@/lib/user-context", () => ({
  useUser: () => mockUseUser(),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

import CreateTeamMemberDialog from "./CreateTeamMemberDialog";

beforeEach(() => {
  mockAddTeamMember.mockReset();
  mockAddMemberToProfile.mockReset();
  mockSaveProfile.mockReset();
  mockUseUser.mockReset();
  mockUseAuth.mockReset();

  mockUseAuth.mockReturnValue({ user: { uid: "u1" } });
});

function setupProfiles(profiles: Record<string, { role?: string; created?: boolean; owner_uid?: string; id?: string; name?: string }>) {
  mockUseUser.mockReturnValue({
    profiles,
    teamMembers: [],
    addTeamMember: mockAddTeamMember,
    addMemberToProfile: mockAddMemberToProfile,
    saveProfile: mockSaveProfile,
  });
}

describe("CreateTeamMemberDialog", () => {
  it("shows the empty-profiles guard when the user has no owned profiles", () => {
    setupProfiles({});
    render(<CreateTeamMemberDialog open={true} onOpenChange={() => {}} />);
    expect(screen.getByText(/no profiles yet/i)).toBeInTheDocument();
  });

  it("disables the Add Member button until name + a profile are selected", () => {
    setupProfiles({
      performer: { role: "performer", created: true, owner_uid: "u1", id: "u1__performer", name: "My Band" },
    });
    render(<CreateTeamMemberDialog open={true} onOpenChange={() => {}} />);
    const addBtn = screen.getByRole("button", { name: /add member/i });
    expect(addBtn).toBeDisabled();
  });

  it("creates a member and fires onCreated when name + profile are set", () => {
    setupProfiles({
      performer: { role: "performer", created: true, owner_uid: "u1", id: "u1__performer", name: "My Band" },
    });
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <CreateTeamMemberDialog
        open={true}
        onOpenChange={onOpenChange}
        defaultProfileIds={["u1__performer"]}
        onCreated={onCreated}
      />,
    );

    // Type a name
    const nameInput = screen.getByPlaceholderText(/full name/i);
    fireEvent.change(nameInput, { target: { value: "Jane Crew" } });

    const addBtn = screen.getByRole("button", { name: /add member/i });
    expect(addBtn).not.toBeDisabled();
    fireEvent.click(addBtn);

    expect(mockAddTeamMember).toHaveBeenCalledTimes(1);
    const [member, firstPid] = mockAddTeamMember.mock.calls[0];
    expect(member.name).toBe("Jane Crew");
    expect(member.profileId).toBe("u1__performer");
    expect(firstPid).toBe("u1__performer");

    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ name: "Jane Crew" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("seeds defaultProfileIds when the dialog opens", () => {
    setupProfiles({
      performer: { role: "performer", created: true, owner_uid: "u1", id: "u1__performer", name: "My Band" },
      venue: { role: "venue", created: true, owner_uid: "u1", id: "u1__venue", name: "My Venue" },
    });

    render(
      <CreateTeamMemberDialog
        open={true}
        onOpenChange={() => {}}
        defaultProfileIds={["u1__venue"]}
      />,
    );

    // The venue checkbox should be checked by default; performer should not.
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // Find the checkbox in the row containing "My Venue"
    const venueRow = screen.getByText("My Venue").closest("label");
    const venueCheckbox = venueRow?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(venueCheckbox.checked).toBe(true);

    const performerRow = screen.getByText("My Band").closest("label");
    const performerCheckbox = performerRow?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(performerCheckbox.checked).toBe(false);

    // Sanity: at least the venue is preselected.
    expect(checkboxes.some(c => c.checked)).toBe(true);
  });

  it("does not call addTeamMember if no profile is selected", () => {
    setupProfiles({
      performer: { role: "performer", created: true, owner_uid: "u1", id: "u1__performer", name: "My Band" },
    });

    render(<CreateTeamMemberDialog open={true} onOpenChange={() => {}} />);

    const nameInput = screen.getByPlaceholderText(/full name/i);
    fireEvent.change(nameInput, { target: { value: "Test User" } });

    const addBtn = screen.getByRole("button", { name: /add member/i });
    expect(addBtn).toBeDisabled();
    fireEvent.click(addBtn);

    expect(mockAddTeamMember).not.toHaveBeenCalled();
  });
});
