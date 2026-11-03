/**
 * AgentsPage.test.tsx
 * ===================
 * Tests:
 * - Restoring persistent agent execution history from conversation messages
 * - Correct user-scoped session key usage
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AgentsPage from "../pages/AgentsPage";

vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark" }),
}));

vi.mock("../services/auth", () => ({
  getUser: () => ({ _id: "u-agent-1", name: "Agent User", role: "member" }),
  createConversation: vi.fn(),
  getMessages: vi.fn(),
  saveMessage: vi.fn(),
}));

vi.mock("../services/api", () => ({
  getAgents: vi.fn(),
  executeAgent: vi.fn(),
}));

import { getMessages } from "../services/auth";
import { getAgents } from "../services/api";

const mockGetMessages = getMessages as ReturnType<typeof vi.fn>;
const mockGetAgents = getAgents as ReturnType<typeof vi.fn>;

function renderPage() {
  return render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>
  );
}

describe("AgentsPage — Persistent History", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetAgents.mockResolvedValue({
      agents: [
        { id: "knowledge", name: "Knowledge Agent", description: "Search knowledge base", available: true },
      ],
      count: 1,
    });
  });

  it("restores prior execution logs from persisted user and assistant messages", async () => {
    // Set stored user-scoped conversation id
    localStorage.setItem("aira_agent_conv_u-agent-1", "conv-agent-100");

    mockGetMessages.mockResolvedValue({
      success: true,
      messages: [
        {
          role: "user",
          content: "Find architecture documents",
          createdAt: "2026-10-21T10:00:00.000Z",
        },
        {
          role: "assistant",
          content: JSON.stringify({
            agent_id: "knowledge",
            agent_name: "Knowledge Agent",
            answer: "Here is the verified architecture.",
            steps: ["Step 1: Searched knowledge base", "Step 2: Retrieved documents"],
            tool_calls: [],
          }),
          createdAt: "2026-10-21T10:00:05.000Z",
          sources: [{ filename: "architecture.md", chunk_index: 0, excerpt: "AIRA system architecture", score: 0.95 }],
        },
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Find architecture documents")).toBeInTheDocument();
    });

    // Expand accordion to reveal answer
    fireEvent.click(screen.getByText("Find architecture documents"));

    await waitFor(() => {
      expect(screen.getByText("Here is the verified architecture.")).toBeInTheDocument();
    });
  });
});
