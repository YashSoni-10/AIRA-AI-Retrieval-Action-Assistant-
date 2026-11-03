/**
 * ChatPage.test.tsx
 * =================
 * Tests:
 * - Conversation history sidebar renders conversations on mount
 * - Clicking a conversation loads its messages
 * - New Chat button resets state
 * - 3-dot menu (Options button) shows Delete option per conversation
 * - Delete confirmation modal: title "Delete Conversation?", confirm button "Delete"
 * - Clear All History: title "Clear All Chat History?", confirm button "Clear All"
 * - Resilience: empty history and network errors handled gracefully
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ChatPage from "../pages/ChatPage";

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark" }),
}));

vi.mock("../components/MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

vi.mock("../services/auth", () => ({
  getUser: () => ({ _id: "u1", name: "Alice", role: "member" }),
  listConversations: vi.fn(),
  createConversation: vi.fn(),
  getMessages: vi.fn(),
  saveMessage: vi.fn(),
  deleteConversation: vi.fn(),
  clearAllConversations: vi.fn(),
}));

vi.mock("../services/api", () => ({
  streamChatMessage: vi.fn(),
}));

// ─── Typed mock references ─────────────────────────────────────────────────────

import {
  listConversations,
  createConversation,
  getMessages,
  deleteConversation,
  clearAllConversations,
} from "../services/auth";

const mockList = listConversations as ReturnType<typeof vi.fn>;
const mockCreate = createConversation as ReturnType<typeof vi.fn>;
const mockGetMessages = getMessages as ReturnType<typeof vi.fn>;
const mockDelete = deleteConversation as ReturnType<typeof vi.fn>;
const mockClearAll = clearAllConversations as ReturnType<typeof vi.fn>;

// ─── Shared data ───────────────────────────────────────────────────────────────

const CONV_A = { _id: "c1", title: "What is AIRA?", message_count: 2, updatedAt: "2026-10-21" };
const CONV_B = { _id: "c2", title: "Architecture Chat", message_count: 4, updatedAt: "2026-10-22" };

const MESSAGES_A = [
  { role: "user", content: "What is AIRA?", sources: [], meta: {} },
  { role: "assistant", content: "AIRA is an AI assistant.", sources: [], meta: {} },
];

// ─── Render helper ─────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <MemoryRouter>
      <ChatPage />
    </MemoryRouter>
  );
}

// ─── Default setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  mockList.mockResolvedValue({ success: true, conversations: [CONV_A, CONV_B] });
  mockCreate.mockResolvedValue({
    success: true,
    conversation: { _id: "c-new", title: "New Chat", message_count: 0 },
  });
  mockGetMessages.mockResolvedValue({ success: true, messages: MESSAGES_A });
  mockDelete.mockResolvedValue({ success: true });
  mockClearAll.mockResolvedValue({ success: true, deletedCount: 2, messagesDeletedCount: 5 });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 1: History Sidebar
// ═══════════════════════════════════════════════════════════════════════════════

describe("ChatPage — History Sidebar", () => {
  it("opens history sidebar and shows conversation titles", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("What is AIRA?")).toBeInTheDocument();
    });

    // Click the History button to open sidebar
    const historyBtn = screen.getByRole("button", { name: /History/i });
    fireEvent.click(historyBtn);

    await waitFor(() => {
      // Both conversations should appear in the sidebar
      expect(screen.getByText("Architecture Chat")).toBeInTheDocument();
    });
  });

  it("clicking a conversation in the sidebar loads its messages", async () => {
    mockGetMessages
      .mockResolvedValueOnce({ success: true, messages: MESSAGES_A }) // initial load
      .mockResolvedValueOnce({
        success: true,
        messages: [
          { role: "user", content: "Explain the architecture.", sources: [], meta: {} },
          { role: "assistant", content: "The architecture consists of...", sources: [], meta: {} },
        ],
      });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("What is AIRA?")).toBeInTheDocument();
    });

    // Open sidebar
    fireEvent.click(screen.getByRole("button", { name: /History/i }));

    await waitFor(() => {
      expect(screen.getByText("Architecture Chat")).toBeInTheDocument();
    });

    // Click CONV_B — the button wrapping the conv title
    fireEvent.click(screen.getByText("Architecture Chat"));

    await waitFor(() => {
      expect(screen.getByText("Explain the architecture.")).toBeInTheDocument();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 2: New Chat
// ═══════════════════════════════════════════════════════════════════════════════

describe("ChatPage — New Chat", () => {
  it("New Chat button clears messages", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("What is AIRA?")).toBeInTheDocument();
    });

    // Header has "+ New Chat" button
    const newChatBtns = screen.getAllByRole("button", { name: /New Chat/i });
    expect(newChatBtns.length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(newChatBtns[0]);
    });

    // Messages should be cleared — the user message no longer appears
    await waitFor(() => {
      expect(screen.queryByText("What is AIRA?")).not.toBeInTheDocument();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 3: Delete Conversation
// ═══════════════════════════════════════════════════════════════════════════════

describe("ChatPage — Delete Conversation", () => {
  it("shows 3-dot Options button for each conversation in sidebar", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("What is AIRA?")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /History/i }));

    await waitFor(() => {
      expect(screen.getByText("Architecture Chat")).toBeInTheDocument();
    });

    // Each conversation has an accessible Options button: aria-label="Options for <title>"
    const optionsBtns = screen.getAllByRole("button", { name: /Options for/i });
    expect(optionsBtns.length).toBeGreaterThan(0);
  });

  it("shows Delete menu item when Options button is clicked", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("What is AIRA?")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /History/i }));

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /Options for/i })).toHaveLength(2);
    });

    // Click the first Options button (for CONV_A)
    fireEvent.click(screen.getAllByRole("button", { name: /Options for/i })[0]);

    await waitFor(() => {
      // The dropdown menu contains a "Delete" span inside the button (with emoji prefix)
      expect(screen.getByText("Delete")).toBeInTheDocument();
    });
  });

  it("shows Delete Conversation confirmation modal and calls deleteConversation on confirm", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("What is AIRA?")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /History/i }));

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /Options for/i })).toHaveLength(2);
    });

    // Open the menu for CONV_A
    fireEvent.click(screen.getAllByRole("button", { name: /Options for/i })[0]);

    await waitFor(() => {
      // The span text "Delete" is in the dropdown
      expect(screen.getByText("Delete")).toBeInTheDocument();
    });

    // Click the dropdown Delete button (contains emoji + Delete span)
    fireEvent.click(screen.getByText("Delete"));

    // Confirmation modal appears with correct title
    await waitFor(() => {
      expect(screen.getByText("Delete Conversation?")).toBeInTheDocument();
    });

    // Confirm deletion — the modal's confirm button text is "Delete" or "Deleting…"
    await act(async () => {
      // getByRole with name includes full accessible name — use getByText for the modal button
      const allDeleteTexts = screen.getAllByText(/^Delete$|^Deleting…$/i);
      // Last one is the modal confirm button
      fireEvent.click(allDeleteTexts[allDeleteTexts.length - 1]);
    });

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("c1");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 4: Clear All History
// ═══════════════════════════════════════════════════════════════════════════════

describe("ChatPage — Clear All History", () => {
  it("Clear All History button is present in the sidebar", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("What is AIRA?")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /History/i }));

    await waitFor(() => {
      expect(screen.getByText(/Clear All History/i)).toBeInTheDocument();
    });
  });

  it("shows Clear All Chat History? modal and calls clearAllConversations on confirm", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("What is AIRA?")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /History/i }));

    await waitFor(() => {
      expect(screen.getByText(/Clear All History/i)).toBeInTheDocument();
    });

    // Click the "Clear All History" button in the sidebar footer
    fireEvent.click(screen.getByText(/Clear All History/i));

    // Modal should appear with correct title
    await waitFor(() => {
      expect(screen.getByText("Clear All Chat History?")).toBeInTheDocument();
    });

    // Click the "Clear All" confirm button
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Clear All$|^Clearing/i }));
    });

    await waitFor(() => {
      expect(mockClearAll).toHaveBeenCalled();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 5: Resilience
// ═══════════════════════════════════════════════════════════════════════════════

describe("ChatPage — Resilience", () => {
  it("renders and creates a new conversation when listConversations returns empty list", async () => {
    mockList.mockResolvedValue({ success: true, conversations: [] });
    mockCreate.mockResolvedValue({
      success: true,
      conversation: { _id: "c-new", title: "New Chat", message_count: 0 },
    });

    renderPage();

    // Should not crash — createConversation is called as fallback
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalled();
    });
  });

  it("renders without crashing when listConversations rejects", async () => {
    mockList.mockRejectedValue(new Error("Network error"));
    mockCreate.mockResolvedValue({
      success: true,
      conversation: { _id: "c-fallback", title: "New Chat", message_count: 0 },
    });

    expect(() => renderPage()).not.toThrow();

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalled();
    });
  });
});
