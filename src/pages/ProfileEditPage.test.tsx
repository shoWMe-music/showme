import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ─── Mocks ────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ role: "venue" }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/firebaseStorageUpload", () => ({
  uploadUserBinary: vi.fn(),
}));

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/AvatarUpload", () => ({
  AvatarUpload: () => <div data-testid="avatar-upload" />,
}));

vi.mock("@/components/AddressAutocomplete", () => ({
  default: () => <div data-testid="address-autocomplete" />,
}));

vi.mock("@/components/VenueMap", () => ({
  default: () => <div data-testid="venue-map" />,
}));

vi.mock("@/components/DocumentPreviewDialog", () => ({
  default: () => null,
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

const mockSaveProfile = vi.fn();
const mockSetProfiles = vi.fn();

const mockUseUser = vi.fn();
vi.mock("@/lib/user-context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/user-context")>("@/lib/user-context");
  return {
    ...actual,
    useUser: () => mockUseUser(),
  };
});

import ProfileEditPage from "./ProfileEditPage";

function makeVenueProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "venue-1",
    role: "venue" as const,
    name: "Test Venue",
    locations: [],
    bio: "",
    genres: [],
    socialLinks: [],
    created: true,
    ...overrides,
  };
}

describe("ProfileEditPage — venue capacity setups (Wave 5 B4)", () => {
  beforeEach(() => {
    mockSaveProfile.mockClear();
    mockSetProfiles.mockClear();
    mockUseUser.mockReset();
  });

  it("renders the Capacity Setups section for a venue profile", () => {
    mockUseUser.mockReturnValue({
      profiles: { venue: makeVenueProfile() },
      setProfiles: mockSetProfiles,
      saveProfile: mockSaveProfile,
      loaded: true,
    });

    render(<ProfileEditPage />);

    expect(screen.getByRole("heading", { name: /Capacity Setups/i })).toBeInTheDocument();
    // Empty state copy
    expect(screen.getByText(/No setups added yet/i)).toBeInTheDocument();
  });

  it("Add Setup creates a row with sitting/standing inputs and a Main checkbox", () => {
    mockUseUser.mockReturnValue({
      profiles: { venue: makeVenueProfile() },
      setProfiles: mockSetProfiles,
      saveProfile: mockSaveProfile,
      loaded: true,
    });

    render(<ProfileEditPage />);

    // The Capacity Setups section has its own Add Setup button — pick the one
    // whose section heading is "Capacity Setups" (the performer section also
    // has an Add Setup button but is hidden because role=venue).
    const addBtn = screen.getByRole("button", { name: /Add Setup/i });
    fireEvent.click(addBtn);

    // After click: a name input + Main checkbox + notes input render
    const nameInput = screen.getByPlaceholderText(/Setup name \(e\.g\. Theater seating\)/i) as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    expect(screen.getByLabelText(/Main/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/removed back rows/i)).toBeInTheDocument();
    // First setup is auto-named "Main" and isMain=true
    expect(nameInput.value).toBe("Main");
  });

  it("does NOT render the 'Add custom deal type' input on a venue profile (Wave 7 C1)", () => {
    // C1: the "Add custom deal type" input + button were removed because the
    // Performance Bonus tiered-deal rebuild was deferred to Wave 8. Existing
    // custom deals on the profile must still render as removable badges.
    mockUseUser.mockReturnValue({
      profiles: { venue: makeVenueProfile({ dealTypes: ["Door Split", "Sponsored Showcase"] }) },
      setProfiles: mockSetProfiles,
      saveProfile: mockSaveProfile,
      loaded: true,
    });

    render(<ProfileEditPage />);

    // The placeholder is gone — no "Add custom deal type" input survives.
    expect(screen.queryByPlaceholderText(/Add custom deal type/i)).toBeNull();

    // But the existing custom deal "Sponsored Showcase" still shows as a badge
    // so legacy data isn't hidden from the user.
    expect(screen.getByText(/Sponsored Showcase/i)).toBeInTheDocument();
  });

  it("preserves existing venueCapacitySetups on the profile", () => {
    mockUseUser.mockReturnValue({
      profiles: {
        venue: makeVenueProfile({
          venueCapacitySetups: [
            { id: "VCS-1", name: "Theater", capacitySitting: 200, capacityStanding: 0, isMain: true },
            { id: "VCS-2", name: "Standing only", capacityStanding: 350, isMain: false },
          ],
        }),
      },
      setProfiles: mockSetProfiles,
      saveProfile: mockSaveProfile,
      loaded: true,
    });

    render(<ProfileEditPage />);

    // Both existing setup names should render
    const inputs = screen.getAllByPlaceholderText(/Setup name/i) as HTMLInputElement[];
    expect(inputs.length).toBe(2);
    expect(inputs[0].value).toBe("Theater");
    expect(inputs[1].value).toBe("Standing only");
  });
});
