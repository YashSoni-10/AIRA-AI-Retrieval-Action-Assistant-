import { useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useTheme } from "./context/ThemeContext";
import { getToken, getMe, logout } from "./services/auth";

// Public pages (no auth required)
import LoginPage from "./pages/LoginPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";

// Components
import Sidebar from "./components/Sidebar";
import EmailVerificationBanner from "./components/EmailVerificationBanner";

// Authenticated pages
import Dashboard from "./pages/Dashboard";
import ChatPage from "./pages/ChatPage";
import KnowledgePage from "./pages/KnowledgePage";
import DocumentsPage from "./pages/DocumentsPage";
import ProjectsPage from "./pages/ProjectsPage";
import GitHubPage from "./pages/GitHubPage";
import UserManagementPage from "./pages/UserManagementPage";
import AgentsPage from "./pages/AgentsPage";
import TaskPage from "./pages/TaskPage";
import SettingsPage from "./pages/SettingsPage";
import NotFoundPage from "./pages/NotFoundPage";
import HelpPage from "./pages/HelpPage";

// ── AppShell — the authenticated layout (sidebar + routes) ───────────────────

function AppShell() {
  const { theme } = useTheme();
  return (
    <div
      className={`relative flex h-screen overflow-hidden transition-colors duration-300 ${
        theme === "dark" ? "bg-[#060812] text-zinc-100" : "bg-slate-50 text-slate-900"
      }`}
    >
      {/* Ambient Glows */}
      {theme === "dark" ? (
        <>
          <div className="fixed -left-40 -top-40 pointer-events-none h-[650px] w-[650px] rounded-full bg-blue-600/25 blur-[160px]" />
          <div className="fixed -right-40 top-1/4 pointer-events-none h-[750px] w-[750px] rounded-full bg-cyan-500/20 blur-[180px]" />
          <div className="fixed bottom-0 left-1/3 pointer-events-none h-[600px] w-[600px] rounded-full bg-indigo-600/15 blur-[160px]" />
        </>
      ) : (
        <>
          <div className="fixed -left-40 -top-40 pointer-events-none h-[650px] w-[650px] rounded-full bg-blue-400/15 blur-[140px]" />
          <div className="fixed -right-40 top-1/4 pointer-events-none h-[750px] w-[750px] rounded-full bg-cyan-400/15 blur-[160px]" />
          <div className="fixed bottom-0 left-1/3 pointer-events-none h-[600px] w-[600px] rounded-full bg-indigo-400/10 blur-[150px]" />
        </>
      )}

      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden scroll-smooth">
        <EmailVerificationBanner />
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/github" element={<GitHubPage />} />
          <Route path="/admin/users" element={<UserManagementPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/tasks" element={<TaskPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </div>
    </div>
  );
}

// ── AuthGate — wraps AppShell, shows LoginPage when not authed ────────────────

interface AuthGateProps {
  authed: boolean;
  setAuthed: (v: boolean) => void;
  children: React.ReactNode;
}

function AuthGate({ authed, setAuthed, children }: AuthGateProps) {
  useEffect(() => {
    if (authed) {
      getMe().catch((err: any) => {
        const msg = String(err?.message || "");
        // Only force-logout on real auth failures, not transient network errors
        if (
          msg.includes("Session expired") ||
          msg.includes("401") ||
          msg.includes("deactivated")
        ) {
          logout();
          setAuthed(false);
        }
      });
    }
  }, [authed, setAuthed]);

  if (!authed) {
    return <LoginPage onSuccess={() => setAuthed(true)} />;
  }
  return <>{children}</>;
}

// ── App — top-level router; public routes are outside AuthGate ────────────────

function App() {
  // Lifted authed state so /reset-password can sign the user in after resetting
  const [authed, setAuthed] = useState<boolean>(!!getToken());

  return (
    <Routes>
      {/* Public — no session needed */}
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route
        path="/reset-password"
        element={<ResetPasswordPage onSuccess={() => setAuthed(true)} />}
      />
      <Route
        path="/verify-email"
        element={<VerifyEmailPage onSuccess={() => setAuthed(true)} />}
      />

      {/* Everything else is behind AuthGate */}
      <Route
        path="/*"
        element={
          <AuthGate authed={authed} setAuthed={setAuthed}>
            <AppShell />
          </AuthGate>
        }
      />
    </Routes>
  );
}

export default App;