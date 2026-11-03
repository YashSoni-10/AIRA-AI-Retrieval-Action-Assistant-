/**
 * AvatarSync.test.tsx
 * ===================
 * Verifies avatar rendering and cross-component synchronization across AIRA frontend:
 * 1. Header displays user avatar image when present, falling back to initials on error or when absent.
 * 2. Header reacts to 'aira_user_updated' event to synchronize profile photo changes without page reload.
 * 3. Sidebar displays user avatar image in profile card, falling back to initials on error or when absent.
 * 4. Sidebar reacts to 'aira_user_updated' event to reflect updated avatar.
 * 5. UserManagementPage displays avatar images for users having an avatar and falls back to initials.
 * 6. uploadAvatar service posts multipart file and syncs auth state via setUser.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Header from "../components/Header";
import Sidebar from "../components/Sidebar";
import UserManagementPage from "../pages/UserManagementPage";
import { setUser, getUser, uploadAvatar, type AuthUser } from "../services/auth";

vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));

// Mock listUsers for UserManagementPage
vi.mock("../services/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/auth")>();
  return {
    ...actual,
    listUsers: vi.fn(),
  };
});

import { listUsers } from "../services/auth";
const mockListUsers = listUsers as ReturnType<typeof vi.fn>;

describe("Avatar Synchronization & Rendering", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("Header component", () => {
    it("renders avatar image when user.avatar is set", () => {
      setUser({
        _id: "u1",
        name: "Helena Admin",
        email: "helena@aira.ai",
        role: "admin",
        avatar: "http://localhost:5000/uploads/avatars/helena.jpg",
        isActive: true,
        createdAt: new Date().toISOString(),
      });

      render(
        <MemoryRouter>
          <Header />
        </MemoryRouter>
      );

      const img = screen.getByRole("img", { name: "Helena Admin" }) as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.src).toBe("http://localhost:5000/uploads/avatars/helena.jpg");
    });

    it("falls back to initial letter when user has no avatar", () => {
      setUser({
        _id: "u1",
        name: "Helena Admin",
        email: "helena@aira.ai",
        role: "admin",
        avatar: "",
        isActive: true,
        createdAt: new Date().toISOString(),
      });

      render(
        <MemoryRouter>
          <Header />
        </MemoryRouter>
      );

      expect(screen.queryByRole("img")).toBeNull();
      expect(screen.getByText("H")).toBeInTheDocument();
    });

    it("falls back to initial letter if avatar image fails to load (onError)", () => {
      setUser({
        _id: "u1",
        name: "Helena Admin",
        email: "helena@aira.ai",
        role: "admin",
        avatar: "http://localhost:5000/uploads/avatars/broken.jpg",
        isActive: true,
        createdAt: new Date().toISOString(),
      });

      render(
        <MemoryRouter>
          <Header />
        </MemoryRouter>
      );

      const img = screen.getByRole("img", { name: "Helena Admin" });
      fireEvent.error(img);

      expect(screen.queryByRole("img")).toBeNull();
      expect(screen.getByText("H")).toBeInTheDocument();
    });

    it("updates avatar immediately when aira_user_updated event fires", () => {
      setUser({
        _id: "u1",
        name: "Helena Admin",
        email: "helena@aira.ai",
        role: "admin",
        avatar: "",
        isActive: true,
        createdAt: new Date().toISOString(),
      });

      render(
        <MemoryRouter>
          <Header />
        </MemoryRouter>
      );

      expect(screen.getByText("H")).toBeInTheDocument();

      act(() => {
        setUser({
          _id: "u1",
          name: "Helena Admin",
          email: "helena@aira.ai",
          role: "admin",
          avatar: "http://localhost:5000/uploads/avatars/new-pic.png",
          isActive: true,
          createdAt: new Date().toISOString(),
        });
      });

      const updatedImg = screen.getByRole("img", { name: "Helena Admin" }) as HTMLImageElement;
      expect(updatedImg).toBeInTheDocument();
      expect(updatedImg.src).toBe("http://localhost:5000/uploads/avatars/new-pic.png");
    });
  });

  describe("Sidebar component", () => {
    it("renders avatar image in profile card when user has avatar", () => {
      setUser({
        _id: "u1",
        name: "Helena Admin",
        email: "helena@aira.ai",
        role: "admin",
        avatar: "http://localhost:5000/uploads/avatars/helena.jpg",
        isActive: true,
        createdAt: new Date().toISOString(),
      });

      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      const img = screen.getByRole("img", { name: "Helena Admin" }) as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.src).toBe("http://localhost:5000/uploads/avatars/helena.jpg");
    });

    it("falls back to initial letter if avatar image fails to load in Sidebar", () => {
      setUser({
        _id: "u1",
        name: "Helena Admin",
        email: "helena@aira.ai",
        role: "admin",
        avatar: "http://localhost:5000/uploads/avatars/broken.jpg",
        isActive: true,
        createdAt: new Date().toISOString(),
      });

      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      const img = screen.getByRole("img", { name: "Helena Admin" });
      fireEvent.error(img);

      expect(screen.queryByRole("img")).toBeNull();
      expect(screen.getByText("H")).toBeInTheDocument();
    });

    it("updates Sidebar avatar when aira_user_updated is dispatched", () => {
      setUser({
        _id: "u1",
        name: "Helena Admin",
        email: "helena@aira.ai",
        role: "admin",
        avatar: "",
        isActive: true,
        createdAt: new Date().toISOString(),
      });

      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      expect(screen.getByText("H")).toBeInTheDocument();

      act(() => {
        setUser({
          _id: "u1",
          name: "Helena Admin",
          email: "helena@aira.ai",
          role: "admin",
          avatar: "http://localhost:5000/uploads/avatars/fresh.png",
          isActive: true,
          createdAt: new Date().toISOString(),
        });
      });

      const img = screen.getByRole("img", { name: "Helena Admin" }) as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.src).toBe("http://localhost:5000/uploads/avatars/fresh.png");
    });
  });

  describe("UserManagementPage component", () => {
    it("renders avatar images in table rows for users who have avatars", async () => {
      setUser({
        _id: "admin1",
        name: "Helena Admin",
        email: "helena@aira.ai",
        role: "admin",
        avatar: "http://localhost:5000/uploads/avatars/helena.jpg",
        isActive: true,
        createdAt: new Date().toISOString(),
      });

      mockListUsers.mockResolvedValue({
        success: true,
        users: [
          {
            _id: "admin1",
            name: "Helena Admin",
            email: "helena@aira.ai",
            role: "admin",
            avatar: "http://localhost:5000/uploads/avatars/helena.jpg",
            isActive: true,
          },
          {
            _id: "mem2",
            name: "Bob Builder",
            email: "bob@aira.ai",
            role: "member",
            avatar: "",
            isActive: true,
          },
        ],
      });

      render(
        <MemoryRouter>
          <UserManagementPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Helena Admin")).toBeInTheDocument();
      });

      // Helena has avatar
      const helenaImg = screen.getByRole("img", { name: "Helena Admin" }) as HTMLImageElement;
      expect(helenaImg).toBeInTheDocument();
      expect(helenaImg.src).toBe("http://localhost:5000/uploads/avatars/helena.jpg");

      // Bob does not have avatar, displays initial
      expect(screen.getByText("B")).toBeInTheDocument();
    });
  });

  describe("uploadAvatar service", () => {
    it("uploads file, saves user in state and dispatches event", async () => {
      const initialUser: AuthUser = {
        _id: "u1",
        name: "Helena Admin",
        email: "helena@aira.ai",
        role: "admin",
        avatar: "",
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      setUser(initialUser);

      const fakeFile = new File(["fake-image-content"], "avatar.png", { type: "image/png" });

      const updatedUser: AuthUser = {
        ...initialUser,
        avatar: "http://localhost:5000/uploads/avatars/avatar-12345.png",
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          avatar: "http://localhost:5000/uploads/avatars/avatar-12345.png",
          user: updatedUser,
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      let eventFired = false;
      const listener = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.avatar === "http://localhost:5000/uploads/avatars/avatar-12345.png") {
          eventFired = true;
        }
      };
      window.addEventListener("aira_user_updated", listener);

      const result = await uploadAvatar(fakeFile);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:5000/api/auth/avatar",
        expect.objectContaining({
          method: "POST",
        })
      );
      expect(result.avatar).toBe("http://localhost:5000/uploads/avatars/avatar-12345.png");
      expect(getUser()?.avatar).toBe("http://localhost:5000/uploads/avatars/avatar-12345.png");
      expect(eventFired).toBe(true);

      window.removeEventListener("aira_user_updated", listener);
    });
  });
});
