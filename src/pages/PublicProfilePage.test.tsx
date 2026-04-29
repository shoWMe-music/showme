import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// ─── Mocks ────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ slug: "my-venue" }),
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

vi.mock("@/components/VenueMap", () => ({
  default: () => <div data-testid="venue-map" />,
}));

vi.mock("@/components/RequestDateForm", () => ({
  default: () => null,
}));

const mockEvents = vi.fn();
const mockUseUser = vi.fn();
vi.mock("@/lib/queries", () => ({
  useEvents: () => mockEvents(),
}));

vi.mock("@/lib/user-context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/user-context")>("@/lib/user-context");
  return {
    ...actual,
    useUser: () => mockUseUser(),
  };
});

vi.mock("@/lib/db", () => ({
  fetchPublicProfileBySlug: vi.fn(() => Promise.resolve(null)),
}));

import PublicProfilePage from "./PublicProfilePage";

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "venue-1",
    role: "venue" as const,
    name: "My Venue",
    locations: [],
    bio: "",
    genres: [],
    socialLinks: [],
    created: true,
    isPublic: true,
    slug: "my-venue",
    ...overrides,
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    name: "Big Show",
    date: "2099-01-01",
    artist: "The Band",
    venue: "My Venue",
    operator: "",
    published: true,
    archived: false,
    eventStatus: "confirmed" as const,
    capacity: 0,
    ticketUrls: [],
    roomStage: "",
    ...overrides,
  };
}

describe("PublicProfilePage — Coming Events section (Wave 5 B6)", () => {
  beforeEach(() => {
    mockEvents.mockReset();
    mockUseUser.mockReset();
    mockUseUser.mockReturnValue({
      profiles: { venue: makeProfile() },
      currentUser: { id: "uid-1" },
      loaded: true,
    });
  });

  it("renders Coming Events with future, published, non-archived events for the profile", async () => {
    mockEvents.mockReturnValue([
      makeEvent({ id: "evt-1", name: "Future Show", date: "2099-01-01", venue: "My Venue" }),
      makeEvent({ id: "evt-2", name: "Past Show", date: "1999-01-01", venue: "My Venue" }),
      makeEvent({ id: "evt-3", name: "Not Mine", date: "2099-01-01", venue: "Other Venue" }),
      makeEvent({ id: "evt-4", name: "Archived Show", date: "2099-01-01", venue: "My Venue", archived: true }),
      makeEvent({ id: "evt-5", name: "Unpublished Show", date: "2099-01-01", venue: "My Venue", published: false }),
    ]);

    render(<PublicProfilePage />);

    await waitFor(() => expect(screen.getByText(/Coming Events/i)).toBeInTheDocument());

    // Future + published + non-archived for "My Venue"
    expect(screen.getByText("Future Show")).toBeInTheDocument();

    // Filtered out
    expect(screen.queryByText("Past Show")).not.toBeInTheDocument();
    expect(screen.queryByText("Not Mine")).not.toBeInTheDocument();
    expect(screen.queryByText("Archived Show")).not.toBeInTheDocument();
    expect(screen.queryByText("Unpublished Show")).not.toBeInTheDocument();
  });

  it("links Coming Events rows to the public event page route /event/$id", async () => {
    mockEvents.mockReturnValue([
      makeEvent({ id: "evt-99", name: "Linkable", date: "2099-01-01", venue: "My Venue" }),
    ]);

    render(<PublicProfilePage />);

    const link = await screen.findByRole("link", { name: /Linkable/i });
    expect(link).toHaveAttribute("href", "/event/evt-99");
  });

  it("shows an empty state when there are no upcoming events", async () => {
    mockEvents.mockReturnValue([]);

    render(<PublicProfilePage />);

    await waitFor(() => expect(screen.getAllByText(/Coming Events/i).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/No upcoming events scheduled/i).length).toBeGreaterThan(0);
  });
});
