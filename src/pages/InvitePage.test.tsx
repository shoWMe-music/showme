/**
 * Tests for /invite?code= landing page.
 *
 * Bug ref (ClickUp 86c9qbj1p): an existing user invited to a role they have no
 * profile for now lands on /invite and gets walked through profile creation.
 * The page covers four branches: signed-out (offer sign-in/sign-up), wrong
 * account (email mismatch), has matching profile (one-click accept), no
 * matching profile (open CreateProfileDialog → claim with new profile id).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockUseSearch,
  mockUseAuth,
  mockNavigate,
  mockToast,
  mockHttpsCallable,
  mockPeekCallable,
  mockClaimCallable,
  mockCreateProfileDialogProps,
} = vi.hoisted(() => {
  const peek = vi.fn();
  const claim = vi.fn();
  const dialogPropsRef: { current: unknown } = { current: null };
  return {
    mockUseSearch: vi.fn(),
    mockUseAuth: vi.fn(),
    mockNavigate: vi.fn(),
    mockToast: vi.fn(),
    mockPeekCallable: peek,
    mockClaimCallable: claim,
    mockHttpsCallable: vi.fn((_fns: unknown, name: string) => {
      if (name === "peekInvitationCode") return peek;
      if (name === "claimInviteWithProfile") return claim;
      throw new Error(`Unexpected callable: ${name}`);
    }),
    mockCreateProfileDialogProps: dialogPropsRef,
  };
});

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => mockUseSearch(),
  useNavigate: () => mockNavigate,
  // Stub <Link> as a plain <a> so we can assert on href/text.
  Link: ({ to, search, children, ...rest }: { to: string; search?: Record<string, string>; children: React.ReactNode; [k: string]: unknown }) => {
    const qs = search ? `?${new URLSearchParams(search as Record<string, string>).toString()}` : "";
    return <a href={`${to}${qs}`} {...rest}>{children}</a>;
  },
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
  toast: mockToast,
  copyToast: vi.fn(),
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mockHttpsCallable,
}));

vi.mock("@/integrations/firebase/app", () => ({
  getFirebaseFunctions: vi.fn().mockReturnValue({}),
}));

// Capture CreateProfileDialog props so tests can trigger onCreated.
vi.mock("@/components/CreateProfileDialog", () => ({
  CreateProfileDialog: (props: unknown) => {
    mockCreateProfileDialogProps.current = props;
    const p = props as { open: boolean; forcedRole?: string };
    return p.open ? <div data-testid="create-profile-dialog" data-role={p.forcedRole} /> : null;
  },
}));

vi.mock("@/assets/showme-logo.png", () => ({ default: "logo.png" }));

import InvitePage from "./InvitePage";

beforeEach(() => {
  mockUseSearch.mockReset();
  mockUseAuth.mockReset();
  mockNavigate.mockReset();
  mockToast.mockReset();
  mockPeekCallable.mockReset();
  mockClaimCallable.mockReset();
  mockCreateProfileDialogProps.current = null;
});

describe("InvitePage — missing code", () => {
  it("shows an invalid-link message when no code is in the URL", () => {
    mockUseSearch.mockReturnValue({ code: undefined });
    mockUseAuth.mockReturnValue({ user: null, loading: false });

    render(<InvitePage />);
    expect(screen.getByText(/invalid invitation link/i)).toBeInTheDocument();
    expect(mockPeekCallable).not.toHaveBeenCalled();
  });
});

describe("InvitePage — signed out", () => {
  it("offers Sign in (with redirect) and Create account (with code)", () => {
    mockUseSearch.mockReturnValue({ code: "ABC123" });
    mockUseAuth.mockReturnValue({ user: null, loading: false });

    render(<InvitePage />);
    expect(mockPeekCallable).not.toHaveBeenCalled();
    const signIn = screen.getByRole("link", { name: /sign in/i });
    const signUp = screen.getByRole("link", { name: /create account/i });
    expect(signIn.getAttribute("href")).toContain("/login?redirect=");
    expect(signIn.getAttribute("href")).toContain(encodeURIComponent("/invite?code=ABC123"));
    expect(signUp.getAttribute("href")).toContain("/signup?code=ABC123");
  });
});

describe("InvitePage — signed in, wrong account", () => {
  it("shows wrong-account message when email mismatch", async () => {
    mockUseSearch.mockReturnValue({ code: "ABC123" });
    mockUseAuth.mockReturnValue({
      user: { uid: "u1", email: "wrong@example.com" },
      loading: false,
    });
    mockPeekCallable.mockResolvedValue({
      data: { status: "active", emailMatches: false },
    });

    render(<InvitePage />);
    await waitFor(() => expect(screen.getByText(/wrong account/i)).toBeInTheDocument());
  });
});

describe("InvitePage — signed in, has matching profile", () => {
  it("auto-claims and navigates to the linked event", async () => {
    mockUseSearch.mockReturnValue({ code: "ABC123" });
    mockUseAuth.mockReturnValue({
      user: { uid: "u1", email: "ran@example.com" },
      loading: false,
    });
    mockPeekCallable.mockResolvedValue({
      data: {
        status: "active",
        emailMatches: true,
        recipientEmail: "ran@example.com",
        recipientRole: "promoter",
        linkedEventId: "EVT-1",
        eventName: "Test Show",
        senderName: "Ori",
        matchingProfile: { id: "profile-promoter", name: "Ran Promotions", role: "promoter" },
      },
    });
    mockClaimCallable.mockResolvedValue({
      data: { ok: true, eventId: "EVT-1", profileId: "profile-promoter" },
    });

    render(<InvitePage />);
    const acceptBtn = await screen.findByRole("button", { name: /accept as ran promotions/i });
    fireEvent.click(acceptBtn);

    await waitFor(() => expect(mockClaimCallable).toHaveBeenCalledWith({
      code: "ABC123",
      profileId: "profile-promoter",
    }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({
      to: "/events/$id",
      params: { id: "EVT-1" },
      replace: true,
    }));
  });
});

describe("InvitePage — signed in, no matching profile", () => {
  beforeEach(() => {
    mockUseSearch.mockReturnValue({ code: "ABC123" });
    mockUseAuth.mockReturnValue({
      user: { uid: "u1", email: "ran@example.com" },
      loading: false,
    });
    mockPeekCallable.mockResolvedValue({
      data: {
        status: "active",
        emailMatches: true,
        recipientEmail: "ran@example.com",
        recipientRole: "promoter",
        linkedEventId: "EVT-1",
        eventName: "Test Show",
        senderName: "Ori",
        // No matchingProfile — the recipient has an account but no promoter profile.
      },
    });
  });

  it("prompts to create a profile in the requested role", async () => {
    render(<InvitePage />);
    await waitFor(() => expect(screen.getByText(/create your profile to accept/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /create promoter profile/i })).toBeInTheDocument();
    // Dialog is closed until the button is clicked.
    expect(screen.queryByTestId("create-profile-dialog")).not.toBeInTheDocument();
  });

  it("opens the CreateProfileDialog with forcedRole when clicked", async () => {
    render(<InvitePage />);
    const btn = await screen.findByRole("button", { name: /create promoter profile/i });
    fireEvent.click(btn);

    await waitFor(() => expect(screen.getByTestId("create-profile-dialog")).toBeInTheDocument());
    expect(screen.getByTestId("create-profile-dialog").getAttribute("data-role")).toBe("promoter");
  });

  it("claims the invite once the new profile is created", async () => {
    mockClaimCallable.mockResolvedValue({
      data: { ok: true, eventId: "EVT-1", profileId: "new-profile-id" },
    });

    render(<InvitePage />);
    const btn = await screen.findByRole("button", { name: /create promoter profile/i });
    fireEvent.click(btn);

    await waitFor(() => expect(mockCreateProfileDialogProps.current).not.toBeNull());
    const props = mockCreateProfileDialogProps.current as { onCreated: (slot: string, id: string) => void };
    props.onCreated("promoter", "new-profile-id");

    await waitFor(() => expect(mockClaimCallable).toHaveBeenCalledWith({
      code: "ABC123",
      profileId: "new-profile-id",
    }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({
      to: "/events/$id",
      params: { id: "EVT-1" },
      replace: true,
    }));
  });
});

describe("InvitePage — used/revoked code", () => {
  beforeEach(() => {
    mockUseSearch.mockReturnValue({ code: "ABC123" });
    mockUseAuth.mockReturnValue({
      user: { uid: "u1", email: "ran@example.com" },
      loading: false,
    });
  });

  it("shows already-used message when the code has been redeemed", async () => {
    mockPeekCallable.mockResolvedValue({ data: { status: "used" } });
    render(<InvitePage />);
    await waitFor(() => expect(screen.getByText(/already used/i)).toBeInTheDocument());
  });

  it("shows not-valid message when the code is revoked", async () => {
    mockPeekCallable.mockResolvedValue({ data: { status: "revoked" } });
    render(<InvitePage />);
    await waitFor(() => expect(screen.getByText(/no longer valid/i)).toBeInTheDocument());
  });
});
