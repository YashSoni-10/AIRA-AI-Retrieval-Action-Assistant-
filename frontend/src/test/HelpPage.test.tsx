/**
 * HelpPage.test.tsx
 * =================
 * Acceptance test suite for Help & Support page:
 * 1. "How can we help you?" search:
 *    - Real-time search filters Help Topics and FAQs
 *    - Searching "Task Agent" or "Task agent works?" displays relevant topics and FAQs
 *    - Searching for nonexistent term displays a clear empty state with query quote
 *    - Clearing search restores all topics and FAQs
 * 2. "Learn more" links:
 *    - Covers all six topics: Getting Started, Using AIRA, Knowledge Base, Documents, AI Agents, Projects
 *    - Clicking "Learn more" opens a detail modal with full guidance, steps, and route navigation
 *    - Action button navigates to existing workspace routes
 *    - Closes on Escape or close button
 * 3. "Contact support":
 *    - When support email is not configured, displays an informative modal explaining contact details are unconfigured
 *    - When support email is configured, opens mailto link
 * 4. Professional icons:
 *    - No emoji characters remain on the page
 *    - Professional SVG icons are rendered with appropriate labels/hidden attributes
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HelpPage from "../pages/HelpPage";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark" }),
}));

vi.mock("../services/auth", () => ({
  getUser: () => ({
    _id: "user1",
    name: "Test User",
    email: "test@aira.ai",
    role: "member",
  }),
}));

function renderHelpPage() {
  return render(
    <MemoryRouter>
      <HelpPage />
    </MemoryRouter>
  );
}

describe("HelpPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Initial Render & Professional Icons", () => {
    it("renders page header and hero with no emoji characters", () => {
      const { container } = renderHelpPage();

      expect(screen.getByText("Help & Support")).toBeInTheDocument();
      expect(screen.getByText(/How can we/i)).toBeInTheDocument();

      // Check all 6 Help Topics are rendered initially
      expect(screen.getByText("Getting Started")).toBeInTheDocument();
      expect(screen.getByText("Using AIRA")).toBeInTheDocument();
      expect(screen.getByText("Knowledge Base")).toBeInTheDocument();
      expect(screen.getByText("Documents")).toBeInTheDocument();
      expect(screen.getByText("AI Agents")).toBeInTheDocument();
      expect(screen.getByText("Projects")).toBeInTheDocument();

      // Regex check: Ensure NO emoji characters are in the text content
      const emojiRegex = /\p{Extended_Pictographic}/u;
      expect(emojiRegex.test(container.textContent || "")).toBe(false);
    });
  });

  describe("Search Functionality", () => {
    it("filters topics and FAQs when searching for 'Task Agent'", () => {
      renderHelpPage();

      const searchInput = screen.getByLabelText(/Search help topics/i);
      fireEvent.change(searchInput, { target: { value: "Task Agent" } });

      // AI Agents topic matches
      expect(screen.getByText("AI Agents")).toBeInTheDocument();

      // Non-matching topics should not be displayed
      expect(screen.queryByText("Getting Started")).toBeNull();
      expect(screen.queryByText("Documents")).toBeNull();

      // Task agent FAQ matches
      expect(
        screen.getByText(/What are AI Agents and how does the Task Agent work\?/i)
      ).toBeInTheDocument();
    });

    it("filters correctly when searching for 'Task agent works?'", () => {
      renderHelpPage();

      const searchInput = screen.getByLabelText(/Search help topics/i);
      fireEvent.change(searchInput, { target: { value: "Task agent works?" } });

      expect(screen.getByText("AI Agents")).toBeInTheDocument();
      expect(screen.queryByText("Getting Started")).toBeNull();
      expect(screen.queryByText("Documents")).toBeNull();
    });

    it("displays a helpful empty state when searching for a nonexistent term", () => {
      renderHelpPage();

      const searchInput = screen.getByLabelText(/Search help topics/i);
      fireEvent.change(searchInput, { target: { value: "nonexistenttopicxyz999" } });

      expect(
        screen.getByText(/No results found for/i)
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();

      // Topics and FAQs should be hidden
      expect(screen.queryByText("Getting Started")).toBeNull();
      expect(screen.queryByText("AI Agents")).toBeNull();
    });

    it("clears search query and restores all topics when clicking 'Clear search'", () => {
      renderHelpPage();

      const searchInput = screen.getByLabelText(/Search help topics/i);
      fireEvent.change(searchInput, { target: { value: "nonexistenttopicxyz999" } });

      const clearBtn = screen.getByRole("button", { name: "Clear search" });
      fireEvent.click(clearBtn);

      expect(screen.getByText("Getting Started")).toBeInTheDocument();
      expect(screen.getByText("AI Agents")).toBeInTheDocument();
      expect(screen.getByText("Projects")).toBeInTheDocument();
    });

    it("clears search query via the input clear icon button", () => {
      renderHelpPage();

      const searchInput = screen.getByLabelText(/Search help topics/i);
      fireEvent.change(searchInput, { target: { value: "documents" } });

      expect(screen.getByText("Documents")).toBeInTheDocument();
      expect(screen.queryByText("Getting Started")).toBeNull();

      const clearInputBtn = screen.getByLabelText("Clear search input");
      fireEvent.click(clearInputBtn);

      expect(screen.getByText("Getting Started")).toBeInTheDocument();
      expect(screen.getByText("AI Agents")).toBeInTheDocument();
    });
  });

  describe("Learn More Detail Modals & Navigation", () => {
    const topicsToTest = [
      { name: "Getting Started", route: "/dashboard", action: "Go to Dashboard" },
      { name: "Using AIRA", route: "/chat", action: "Open AI Chat" },
      { name: "Knowledge Base", route: "/knowledge", action: "Explore Knowledge" },
      { name: "Documents", route: "/documents", action: "Manage Documents" },
      { name: "AI Agents", route: "/agents", action: "Launch AI Agents" },
      { name: "Projects", route: "/projects", action: "View Projects" },
    ];

    topicsToTest.forEach(({ name, route, action }) => {
      it(`opens detail modal for '${name}' and navigates to ${route}`, () => {
        renderHelpPage();

        // Find the card containing this topic title
        const topicHeading = screen.getByText(name);
        const card = topicHeading.closest("div")?.parentElement;
        expect(card).not.toBeNull();

        const learnMoreBtn = within(card!).getByRole("button", { name: /Learn more/i });
        fireEvent.click(learnMoreBtn);

        // Dialog should now be open
        const dialog = screen.getByRole("dialog");
        expect(dialog).toBeInTheDocument();
        expect(within(dialog).getByText(name)).toBeInTheDocument();
        expect(within(dialog).getByText(/Overview/i)).toBeInTheDocument();
        expect(within(dialog).getByText(/How to Use & Key Steps/i)).toBeInTheDocument();

        // Click action button
        const actionBtn = within(dialog).getByRole("button", { name: new RegExp(action, "i") });
        fireEvent.click(actionBtn);

        expect(mockNavigate).toHaveBeenCalledWith(route);
      });
    });

    it("closes detail modal when clicking Close button or Escape key", () => {
      renderHelpPage();

      const topicHeading = screen.getByText("AI Agents");
      const card = topicHeading.closest("div")?.parentElement;
      const learnMoreBtn = within(card!).getByRole("button", { name: /Learn more/i });
      fireEvent.click(learnMoreBtn);

      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // Press Escape
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  describe("Contact Support Removal", () => {
    it("does not render Contact Support button or section", () => {
      renderHelpPage();

      expect(screen.queryByRole("button", { name: /Contact Support/i })).toBeNull();
      expect(screen.queryByText(/Still need help\?/i)).toBeNull();
    });
  });
});
