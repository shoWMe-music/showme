/**
 * Regression tests for the Copy-Link / Send-Email split in
 * InviteCollaboratorDialog.
 *
 * Bug ref (ClickUp 86c9m5hmr — "Copy Link Bug"):
 * Pressing Copy Link silently fired the same flow as Send Email — adding the
 * collaborator AND triggering the welcome email. The email's link was also
 * broken (/event/<id> 404'd because that route is the public-event SSR).
 *
 * The fix routes both buttons through generateInvite(intent), and gates the
 * email-send on intent === "send-email" via a new `sendEmail` flag passed
 * straight through to addExistingUserAsCollaborator. Copy Link still adds the
 * collaborator (so the event lands in their calendar), but skips the email
 * and writes a real /events/<id> URL to the clipboard.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockToast,
  mockCopyToast,
  mockClipboardWriteText,
  mockUseAuth,
  mockUseContacts,
  mockUseMyInvitationCodes,
  mockUseAddContact,
  mockUseQueryClient,
  mockCreatePerformerInvitation,
  mockSendPerformerInvitationEmail,
  mockLookupCallable,
  mockAddExistingCallable,
  mockHttpsCallable,
} = vi.hoisted(() => {
  const lookup = vi.fn();
  const addExisting = vi.fn();
  return {
    mockToast: vi.fn(),
    mockCopyToast: vi.fn(),
    mockClipboardWriteText: vi.fn().mockResolvedValue(undefined),
    mockUseAuth: vi.fn(),
    mockUseContacts: vi.fn().mockReturnValue([]),
    mockUseMyInvitationCodes: vi.fn().mockReturnValue({ data: [] }),
    mockUseAddContact: vi.fn().mockReturnValue({ mutate: vi.fn() }),
    mockUseQueryClient: vi.fn().mockReturnValue({}),
    mockCreatePerformerInvitation: vi.fn(),
    mockSendPerformerInvitationEmail: vi.fn().mockResolvedValue(undefined),
    mockLookupCallable: lookup,
    mockAddExistingCallable: addExisting,
    mockHttpsCallable: vi.fn((_fns: unknown, name: string) => {
      if (name === "lookupUserForInvite") return lookup;
      if (name === "addExistingUserAsCollaborator") return addExisting;
      throw new Error(`Unexpected callable: ${name}`);
    }),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  toast: mockToast,
  copyToast: mockCopyToast,
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/lib/queries", () => ({
  useContacts: () => mockUseContacts(),
}));

vi.mock("@/lib/queries/useInvitationCodes", () => ({
  useMyInvitationCodes: () => mockUseMyInvitationCodes(),
}));

vi.mock("@/lib/queries/useContactMutations", () => ({
  useAddContact: () => mockUseAddContact(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mockUseQueryClient(),
}));

vi.mock("@/lib/createPerformerInvitation", () => ({
  createPerformerInvitation: mockCreatePerformerInvitation,
  sendPerformerInvitationEmail: mockSendPerformerInvitationEmail,
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mockHttpsCallable,
}));

vi.mock("@/integrations/firebase/app", () => ({
  getFirebaseFunctions: vi.fn().mockReturnValue({}),
}));

import InviteCollaboratorDialog from "./InviteCollaboratorDialog";

beforeEach(() => {
  mockToast.mockReset();
  mockCopyToast.mockReset();
  mockClipboardWriteText.mockReset().mockResolvedValue(undefined);
  mockUseAuth.mockReset().mockReturnValue({ user: { uid: "inviter-uid", email: "inviter@example.com", displayName: "Inviter" } });
  mockUseContacts.mockReset().mockReturnValue([]);
  mockUseMyInvitationCodes.mockReset().mockReturnValue({ data: [] });
  mockUseAddContact.mockReset().mockReturnValue({ mutate: vi.fn() });
  mockUseQueryClient.mockReset().mockReturnValue({});
  mockCreatePerformerInvitation.mockReset();
  mockSendPerformerInvitationEmail.mockReset().mockResolvedValue(undefined);
  mockLookupCallable.mockReset();
  mockAddExistingCallable.mockReset();

  Object.assign(navigator, {
    clipboard: { writeText: mockClipboardWriteText },
  });
});

function renderDialog() {
  return render(
    <InviteCollaboratorDialog
      open={true}
      onOpenChange={() => {}}
      eventName="Test Event"
      eventId="EVT-001"
      defaultEmail="recipient@example.com"
      defaultRole="Performer"
    />,
  );
}

describe("InviteCollaboratorDialog — existing user path", () => {
  beforeEach(() => {
    mockLookupCallable.mockResolvedValue({
      data: {
        exists: true,
        uid: "recipient-uid",
        hasMatchingProfile: true,
        matchingProfile: { id: "profile-1", name: "Recipient", role: "performer" },
      },
    });
    mockAddExistingCallable.mockResolvedValue({
      data: { ok: true, collaboratorId: "collab-1", userUid: "recipient-uid" },
    });
  });

  it("Copy Link adds the collaborator with sendEmail: false", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

    await waitFor(() => expect(mockAddExistingCallable).toHaveBeenCalledTimes(1));
    expect(mockAddExistingCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "EVT-001",
        email: "recipient@example.com",
        profileId: "profile-1",
        sendEmail: false,
      }),
    );
  });

  it("Copy Link writes a real /events/<id> URL to the clipboard for existing users", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

    await waitFor(() => expect(mockClipboardWriteText).toHaveBeenCalled());
    const written = mockClipboardWriteText.mock.calls[0][0] as string;
    expect(written).toBe(`${window.location.origin}/events/EVT-001`);
    expect(written).not.toContain("/event/EVT-001"); // singular path was the bug
    expect(mockCopyToast).toHaveBeenCalledWith("Link copied", expect.any(String));
  });

  it("Send Email adds the collaborator with sendEmail: true", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /send email/i }));

    await waitFor(() => expect(mockAddExistingCallable).toHaveBeenCalledTimes(1));
    expect(mockAddExistingCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "EVT-001",
        sendEmail: true,
      }),
    );
    // For existing users, the dialog skips its own sendPerformerInvitationEmail
    // (the cloud function handles the welcome email instead).
    expect(mockSendPerformerInvitationEmail).not.toHaveBeenCalled();
  });
});

describe("InviteCollaboratorDialog — new user path", () => {
  beforeEach(() => {
    mockLookupCallable.mockResolvedValue({ data: { exists: false } });
    mockCreatePerformerInvitation.mockResolvedValue({
      url: "https://app.example/invite?code=ABC123",
      code: "ABC123",
    });
  });

  it("Copy Link mints an invitation and copies the invite URL", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

    await waitFor(() => expect(mockCreatePerformerInvitation).toHaveBeenCalledTimes(1));
    expect(mockAddExistingCallable).not.toHaveBeenCalled();
    await waitFor(() => expect(mockClipboardWriteText).toHaveBeenCalled());
    expect(mockClipboardWriteText.mock.calls[0][0]).toBe(
      "https://app.example/invite?code=ABC123",
    );
    expect(mockSendPerformerInvitationEmail).not.toHaveBeenCalled();
  });

  it("Send Email mints the invitation and sends the welcome email", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /send email/i }));

    await waitFor(() => expect(mockSendPerformerInvitationEmail).toHaveBeenCalledTimes(1));
    expect(mockCreatePerformerInvitation).toHaveBeenCalledTimes(1);
    expect(mockAddExistingCallable).not.toHaveBeenCalled();
    expect(mockSendPerformerInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "ABC123",
        recipientEmail: "recipient@example.com",
        eventName: "Test Event",
      }),
    );
  });
});

// Bug ref (ClickUp 86c9qbj1p): inviting an existing user as a role they don't
// yet have a profile for used to hard-fail with a destructive toast. The fix
// routes that case through the invitation-code flow so the /invite page can
// walk them through profile creation on accept.
describe("InviteCollaboratorDialog — existing user without matching profile", () => {
  beforeEach(() => {
    mockLookupCallable.mockResolvedValue({
      data: {
        exists: true,
        uid: "recipient-uid",
        hasMatchingProfile: false,
      },
    });
    mockCreatePerformerInvitation.mockResolvedValue({
      url: "https://app.example/invite?code=XYZ789",
      code: "XYZ789",
    });
  });

  it("Copy Link no longer hard-fails — mints an invitation and copies the link", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

    await waitFor(() => expect(mockCreatePerformerInvitation).toHaveBeenCalledTimes(1));
    expect(mockAddExistingCallable).not.toHaveBeenCalled();
    await waitFor(() => expect(mockClipboardWriteText).toHaveBeenCalled());
    expect(mockClipboardWriteText.mock.calls[0][0]).toBe(
      "https://app.example/invite?code=XYZ789",
    );
    // The pre-fix destructive toast must not surface.
    const destructiveCalls = mockToast.mock.calls.filter(([arg]) => arg?.variant === "destructive");
    expect(destructiveCalls).toHaveLength(0);
  });

  it("Send Email no longer hard-fails — mints an invitation and sends the welcome email", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /send email/i }));

    await waitFor(() => expect(mockSendPerformerInvitationEmail).toHaveBeenCalledTimes(1));
    expect(mockCreatePerformerInvitation).toHaveBeenCalledTimes(1);
    expect(mockAddExistingCallable).not.toHaveBeenCalled();
    expect(mockSendPerformerInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ code: "XYZ789", recipientEmail: "recipient@example.com" }),
    );
    const destructiveCalls = mockToast.mock.calls.filter(([arg]) => arg?.variant === "destructive");
    expect(destructiveCalls).toHaveLength(0);
  });
});
