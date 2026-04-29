import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────────────
// Render TanStack <Link> as a plain anchor so we can read `href` directly.
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
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

// Avoid pulling in firebase/firestore through @/lib/db.
vi.mock("@/lib/db", () => ({
  fetchProfilePreview: vi.fn(),
}));

const mockUseQueryFn = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryFn: () => unknown }) => mockUseQueryFn(opts),
}));

const mockUseContactsFn = vi.fn();
vi.mock("@/lib/queries", () => ({
  useContacts: () => mockUseContactsFn(),
}));

import { ProfilePreviewPopover } from "./ProfilePreviewPopover";

function setProfilePreviewData(data: unknown) {
  mockUseQueryFn.mockReturnValue({ data });
}

function setContacts(contacts: Array<{ id: string; name: string; type: string | string[] }>) {
  mockUseContactsFn.mockReturnValue(contacts);
}

async function openHoverCard() {
  // The trigger is the <button> wrapping the avatar + name. Hover events open
  // the Radix HoverCard.
  const trigger = screen.getByRole("button");
  fireEvent.pointerEnter(trigger);
  fireEvent.mouseEnter(trigger);
  fireEvent.focus(trigger);
}

describe("ProfilePreviewPopover", () => {
  beforeEach(() => {
    mockUseQueryFn.mockReset();
    mockUseContactsFn.mockReset();
    setContacts([]);
  });

  it("renders a public-route link (new tab) when profile has slug and isPublic", async () => {
    setProfilePreviewData({
      id: "p-aurora",
      name: "Aurora",
      type: "performer",
      slug: "aurora",
      isPublic: true,
    });
    render(<ProfilePreviewPopover name="Aurora" profileId="p-aurora" />);
    await openHoverCard();

    await waitFor(() => {
      const link = screen.getByRole("link", { name: /View Profile/i });
      expect(link).toHaveAttribute("href", "/p/aurora");
      expect(link).toHaveAttribute("target", "_blank");
    });
  });

  it("renders a new-tab link when profile has slug but isPublic is false", async () => {
    // Non-public profiles still navigate to /p/<slug> in a new tab —
    // PublicProfilePage handles the owner-side lookup for non-public docs.
    setProfilePreviewData({
      id: "p-ran",
      name: "Ran Nir",
      type: "performer",
      slug: "ran-nir",
      isPublic: false,
    });
    render(<ProfilePreviewPopover name="Ran Nir" profileId="p-ran" />);
    await openHoverCard();

    await waitFor(() => {
      const link = screen.getByRole("link", { name: /View Profile/i });
      expect(link).toHaveAttribute("href", "/p/ran-nir");
      expect(link).toHaveAttribute("target", "_blank");
    });
  });

  it("renders no profile link when no profile and no contact match", async () => {
    setProfilePreviewData(null);
    setContacts([]);
    render(<ProfilePreviewPopover name="Unknown Person" />);
    await openHoverCard();

    // No "View Profile" link should appear.
    expect(screen.queryByRole("link", { name: /View Profile/i })).not.toBeInTheDocument();
  });
});
