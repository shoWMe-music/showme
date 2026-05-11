import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mocks ────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    let href = to;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        href = href.replace(`$${k}`, v);
      }
    }
    return <a href={href} {...rest}>{children}</a>;
  },
}));

const mockDeleteProfile = vi.fn(() => Promise.resolve());
vi.mock("@/lib/db", () => ({
  fetchProfileMembershipBatch: vi.fn(() => Promise.resolve([])),
  setProfileMemberRole: vi.fn(() => Promise.resolve()),
  removeProfileMember: vi.fn(() => Promise.resolve()),
  inviteProfileAdmin: vi.fn(() => Promise.resolve()),
  cancelProfileInvite: vi.fn(() => Promise.resolve()),
  deleteProfile: (id: string) => mockDeleteProfile(id),
  fetchPendingProfileInvitesForEmail: vi.fn(() => Promise.resolve([])),
  acceptProfileInvite: vi.fn(() => Promise.resolve()),
  declineProfileInvite: vi.fn(() => Promise.resolve()),
  // Used by useAllProfiles via the same TanStack cache key as useUser().profiles.
  fetchProfiles: vi.fn(() => Promise.resolve({ slotted: {}, all: [] })),
}));

const mockUseUser = vi.fn();
const mockUseAuth = vi.fn();
vi.mock("@/lib/user-context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/user-context")>("@/lib/user-context");
  return {
    ...actual,
    useUser: () => mockUseUser(),
  };
});

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

import { ProfileAdminsTab } from "./ProfileAdminsTab";

function makeProfile(overrides: { id: string; name?: string; role?: string; created?: boolean; owner_uid?: string }) {
  return {
    name: overrides.name ?? "Profile",
    role: overrides.role ?? "venue",
    locations: [],
    bio: "",
    genres: [],
    socialLinks: [],
    created: overrides.created ?? true,
    owner_uid: overrides.owner_uid ?? "uid-1",
    ...overrides,
  };
}

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("ProfileAdminsTab", () => {
  beforeEach(() => {
    mockDeleteProfile.mockClear();
    mockUseUser.mockReset();
    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue({ user: { uid: "uid-1", email: "owner@example.com" } });
  });

  it("renders Edit Profile and Delete buttons for an owned profile", async () => {
    const setProfiles = vi.fn();
    mockUseUser.mockReturnValue({
      profiles: {
        venue: makeProfile({ id: "venue-1", name: "My Venue", role: "venue" }),
      },
      setProfiles,
      loaded: true,
    });

    renderWithQuery(<ProfileAdminsTab />);

    await waitFor(() => {
      expect(screen.getByText("My Venue")).toBeInTheDocument();
    });

    // Edit Profile link routes to /profiles/<profileId>/edit
    const editLink = screen.getByRole("link", { name: /Edit Profile/i });
    expect(editLink).toHaveAttribute("href", "/profiles/venue-1/edit");

    // Delete button is present
    expect(screen.getByRole("button", { name: /Delete/i })).toBeInTheDocument();
  });

  it("calls deleteProfile + setProfiles when the user confirms deletion (two-step)", async () => {
    const setProfiles = vi.fn();
    mockUseUser.mockReturnValue({
      profiles: {
        venue: makeProfile({ id: "venue-1", name: "My Venue", role: "venue" }),
      },
      setProfiles,
      loaded: true,
    });

    renderWithQuery(<ProfileAdminsTab />);

    await waitFor(() => expect(screen.getByText("My Venue")).toBeInTheDocument());

    // Stage 1: click Delete on the row
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));

    // Stage 1 dialog: data-loss warning
    const warning = await screen.findByText(/all your data associated with it will be lost/i);
    expect(warning).toBeInTheDocument();

    // Click Continue to advance to stage 2
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

    // Stage 2 dialog: type-name confirmation, button disabled until match
    const input = await screen.findByPlaceholderText("My Venue");
    const finalBtn = screen.getByRole("button", { name: /Delete Profile/i });
    expect(finalBtn).toBeDisabled();

    // Wrong name: still disabled
    fireEvent.change(input, { target: { value: "wrong" } });
    expect(finalBtn).toBeDisabled();

    // Correct name: enabled, then click confirms
    fireEvent.change(input, { target: { value: "My Venue" } });
    expect(finalBtn).not.toBeDisabled();
    fireEvent.click(finalBtn);

    await waitFor(() => {
      expect(mockDeleteProfile).toHaveBeenCalledWith("venue-1");
    });
    expect(setProfiles).toHaveBeenCalled();
  });

  it("does NOT call deleteProfile if the user cancels at stage 1 of the two-step delete (Wave 5 B3)", async () => {
    const setProfiles = vi.fn();
    mockUseUser.mockReturnValue({
      profiles: {
        venue: makeProfile({ id: "venue-1", name: "My Venue", role: "venue" }),
      },
      setProfiles,
      loaded: true,
    });

    renderWithQuery(<ProfileAdminsTab />);

    await waitFor(() => expect(screen.getByText("My Venue")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));

    // Stage 1: hit Cancel
    const cancelBtn = await screen.findByRole("button", { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    expect(mockDeleteProfile).not.toHaveBeenCalled();
    expect(setProfiles).not.toHaveBeenCalled();
  });

  it("renders the phantom 'artist' slot with a Delete button (Bug 2)", async () => {
    // A legacy doc with slot "artist" must still appear so the user can remove it.
    // (normalizeLegacyProfiles will have already coerced its role to "performer".)
    const setProfiles = vi.fn();
    mockUseUser.mockReturnValue({
      profiles: {
        artist: makeProfile({ id: "uid-1__artist", name: "Phantom", role: "performer", owner_uid: "uid-1" }),
        venue: makeProfile({ id: "venue-1", name: "My Venue", role: "venue" }),
      },
      setProfiles,
      loaded: true,
    });

    renderWithQuery(<ProfileAdminsTab />);

    await waitFor(() => {
      expect(screen.getByText("Phantom")).toBeInTheDocument();
    });

    // Both profiles render Delete buttons
    const deleteButtons = screen.getAllByRole("button", { name: /Delete/i });
    expect(deleteButtons.length).toBeGreaterThanOrEqual(2);

    // Phantom row is annotated as legacy
    expect(screen.getByText(/legacy — please delete/i)).toBeInTheDocument();
  });
});
