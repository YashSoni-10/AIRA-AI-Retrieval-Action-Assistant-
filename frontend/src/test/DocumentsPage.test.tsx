/**
 * DocumentsPage.test.tsx
 * =======================
 * Tests:
 * - Documents rendering
 * - Expandable Document Preview (Phase 4C) toggling and chunk rendering
 * - Remove button: confirmation dialog + two-phase deletion (Qdrant + MongoDB)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DocumentsPage from "../pages/DocumentsPage";

vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark" }),
}));

vi.mock("../services/auth", () => ({
  getUser: () => ({ _id: "u1", name: "Alice", role: "member" }),
}));

vi.mock("../services/api", () => ({
  listDocumentsFromBackend: vi.fn(),
  listDocuments: vi.fn(),
  ingestDocument: vi.fn(),
  deleteDocument: vi.fn(),
  deleteDocumentById: vi.fn(),
  getDocumentPreview: vi.fn(),
}));

import {
  listDocumentsFromBackend,
  getDocumentPreview,
  deleteDocument,
  deleteDocumentById,
} from "../services/api";
const mockListDocumentsFromBackend = listDocumentsFromBackend as ReturnType<typeof vi.fn>;
const mockGetDocumentPreview = getDocumentPreview as ReturnType<typeof vi.fn>;
const mockDeleteDocument = deleteDocument as ReturnType<typeof vi.fn>;
const mockDeleteDocumentById = deleteDocumentById as ReturnType<typeof vi.fn>;

const MOCK_DOCS = [
  {
    _id: "doc-1",
    filename: "system_architecture.md",
    original_filename: "system_architecture.md",
    file_type: ".md",
    file_size_bytes: 4096,
    ingestion_status: "indexed" as const,
    chunk_count: 2,
    vectors_stored: 2,
    createdAt: "2026-10-21T00:00:00.000Z",
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <DocumentsPage />
    </MemoryRouter>
  );
}

describe("DocumentsPage — Document Preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders preview button and toggles document preview panel on click", async () => {
    mockListDocumentsFromBackend.mockResolvedValue({
      success: true,
      documents: MOCK_DOCS,
    });

    mockGetDocumentPreview.mockResolvedValue({
      status: "success",
      filename: "system_architecture.md",
      chunks: [
        { chunk_index: 0, text: "Chunk 1 content preview", page_number: 1 },
        { chunk_index: 1, text: "Chunk 2 content preview", page_number: 1 },
      ],
      total_chunks: 2,
      preview_text: "Chunk 1 content preview\n\n---\n\nChunk 2 content preview",
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("system_architecture.md")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Preview/i })).toBeInTheDocument();
    });

    // Click Preview button
    const previewBtn = screen.getByRole("button", { name: /Preview/i });
    fireEvent.click(previewBtn);

    await waitFor(() => {
      expect(mockGetDocumentPreview).toHaveBeenCalledWith("system_architecture.md");
      expect(screen.getByText(/Chunk 1 content preview/i)).toBeInTheDocument();
      expect(screen.getByText(/Chunk 2 content preview/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Hide Preview/i })).toBeInTheDocument();
    });

    // Click Hide Preview button
    fireEvent.click(screen.getByRole("button", { name: /Hide Preview/i }));
    await waitFor(() => {
      expect(screen.queryByText(/Chunk 1 content preview/i)).toBeNull();
    });
  });
});

describe("DocumentsPage — Remove button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListDocumentsFromBackend.mockResolvedValue({
      success: true,
      documents: MOCK_DOCS,
    });
  });

  it("shows a confirmation dialog when Remove is clicked", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("system_architecture.md")).toBeInTheDocument();
    });

    // Click Remove
    const removeBtn = screen.getByRole("button", { name: /Remove system_architecture\.md/i });
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(
        screen.getByText(/Are you sure you want to remove/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Its indexed knowledge will also be deleted/i)
      ).toBeInTheDocument();
    });
  });

  it("cancels deletion when Cancel is clicked in confirmation dialog", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("system_architecture.md")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Remove system_architecture\.md/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    // Neither delete function should have been called
    expect(mockDeleteDocument).not.toHaveBeenCalled();
    expect(mockDeleteDocumentById).not.toHaveBeenCalled();
  });

  it("calls deleteDocument (Qdrant) and deleteDocumentById (MongoDB) on confirm", async () => {
    mockDeleteDocument.mockResolvedValue({ status: "success", message: "Removed" });
    mockDeleteDocumentById.mockResolvedValue({ success: true, message: "Deleted" });
    // After deletion, list returns empty
    mockListDocumentsFromBackend
      .mockResolvedValueOnce({ success: true, documents: MOCK_DOCS })
      .mockResolvedValueOnce({ success: true, documents: [] });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("system_architecture.md")).toBeInTheDocument();
    });

    // Open confirm dialog
    fireEvent.click(screen.getByRole("button", { name: /Remove system_architecture\.md/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Confirm deletion
    fireEvent.click(screen.getByRole("button", { name: /^Remove$/i }));

    await waitFor(() => {
      expect(mockDeleteDocument).toHaveBeenCalledWith("system_architecture.md");
      expect(mockDeleteDocumentById).toHaveBeenCalledWith("doc-1");
    });

    // Document card should be gone from the list
    await waitFor(() => {
      expect(screen.queryByText("system_architecture.md")).toBeNull();
    });

    // Success banner should appear
    expect(
      screen.getByText(/removed successfully/i)
    ).toBeInTheDocument();
  });

  it("shows an error banner and keeps the card when Qdrant delete fails", async () => {
    mockDeleteDocument.mockRejectedValue(new Error("Qdrant unavailable"));
    // List stays the same (doc not removed)
    mockListDocumentsFromBackend.mockResolvedValue({ success: true, documents: MOCK_DOCS });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("system_architecture.md")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Remove system_architecture\.md/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Remove$/i }));

    await waitFor(() => {
      expect(mockDeleteDocumentById).not.toHaveBeenCalled();
      expect(screen.getByText(/Could not remove/i)).toBeInTheDocument();
    });

    // Card must still be present
    expect(screen.getByText("system_architecture.md")).toBeInTheDocument();
  });
});
