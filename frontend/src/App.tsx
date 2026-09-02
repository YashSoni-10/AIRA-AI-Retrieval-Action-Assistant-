import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useTheme } from "./context/ThemeContext";
import { getToken, getUser } from "./services/auth";
import LoginPage from "./pages/LoginPage";

function AuthGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean>(!!getToken());
  if (!authed) {
    return <LoginPage onSuccess={() => setAuthed(true)} />;
  }
  return <>{children}</>;
}

// Components
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import SearchBox from "./components/SearchBox";
import StatsCard from "./components/StatsCard";
import ActivityPanel from "./components/ActivityPanel";
import AIAssistant from "./components/AIAssistant";

// Pages
import ChatPage from "./pages/ChatPage";
import KnowledgePage from "./pages/KnowledgePage";
import DocumentsPage from "./pages/DocumentsPage";
import ProjectsPage from "./pages/ProjectsPage";
import AgentsPage from "./pages/AgentsPage";
import SettingsPage from "./pages/SettingsPage";
import NotFoundPage from "./pages/NotFoundPage";
import HelpPage from "./pages/HelpPage";

// ========================
// Dashboard
// ========================

function Dashboard() {
  const { theme } = useTheme();
  const user = getUser();
  const firstName = user?.name ? user.name.split(" ")[0] : "Yash";

  return (
    <div className="flex min-h-full flex-1 flex-col pt-16 md:pt-0">

      {/* Desktop Header */}
      <div className="hidden md:block">
        <Header />
      </div>

      {/* Dashboard Content */}
      <main
        className={`relative flex-1 px-5 py-6 transition-colors duration-300 sm:px-8 md:px-10 md:py-10 ${
          theme === "dark" ? "bg-[#060812] text-zinc-100" : "bg-slate-50 text-slate-900"
        }`}
      >

        <div className="mx-auto max-w-6xl">

          {/* Welcome Header */}
          <section
            className={`group relative overflow-hidden rounded-3xl border p-6 sm:p-8 backdrop-blur-2xl transition-all duration-300 ease-out hover:-translate-y-1 ${
              theme === "dark"
                ? "border-white/15 bg-gradient-to-r from-[#0d1326]/90 via-[#101830]/80 to-[#0a0e1c]/90 text-white shadow-[0_25px_50px_-12px_rgba(0,0,0,0.7)] hover:border-cyan-400/40 hover:shadow-[0_25px_50px_rgba(6,182,212,0.25)]"
                : "border-white/40 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white shadow-[0_20px_40px_-10px_rgba(37,99,235,0.3)] hover:shadow-[0_25px_50px_-5px_rgba(37,99,235,0.4)]"
            }`}
          >
            {/* Inner top highlight border line */}
            <div
              className={`absolute inset-x-0 top-0 h-[1px] ${
                theme === "dark"
                  ? "bg-gradient-to-r from-cyan-500/0 via-cyan-400/60 via-blue-400/60 to-indigo-500/0"
                  : "bg-gradient-to-r from-transparent via-white/50 to-transparent"
              }`}
            />
            
            <div className="relative z-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <div
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
                    theme === "dark"
                      ? "border-cyan-400/30 bg-cyan-500/15 text-cyan-300"
                      : "border-white/30 bg-white/20 text-white backdrop-blur-md"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  Intelligent Workspace Active
                </div>
                <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                  Hello,{" "}
                  <span
                    className={
                      theme === "dark"
                        ? "bg-gradient-to-r from-cyan-300 via-blue-300 to-indigo-300 bg-clip-text text-transparent"
                        : "text-cyan-200"
                    }
                  >
                    {firstName}
                  </span>{" "}
                  👋
                </h1>
                <p className={`mt-2 max-w-lg text-sm sm:text-base ${theme === "dark" ? "text-zinc-400" : "text-blue-100"}`}>
                  Your AI-powered workspace at a glance. Streamline complex workflows with intelligent AI agents.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl border text-2xl shadow-lg ${
                    theme === "dark"
                      ? "border-cyan-400/40 bg-cyan-500/20 text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.3)]"
                      : "border-white/30 bg-white/20 text-cyan-200 backdrop-blur-md"
                  }`}
                >
                  ⚡
                </div>
              </div>
            </div>
          </section>

          {/* AI Search */}
          <SearchBox />

          {/* Statistics */}
          <section className="mt-6 grid gap-4 sm:mt-8 sm:grid-cols-2 lg:grid-cols-4">

            <StatsCard
              icon="📚"
              title="Knowledge Sources"
              value="128"
              description="Documents indexed"
            />

            <StatsCard
              icon="💬"
              title="Conversations"
              value="24"
              description="AI conversations"
            />

            <StatsCard
              icon="⚡"
              title="Active Tasks"
              value="12"
              description="Tasks in progress"
            />

            <StatsCard
              icon="✦"
              title="AI Activity"
              value="94%"
              description="Successful responses"
            />

          </section>

          {/* Recent Activity + AI Assistant */}
          <section className="mt-6 grid gap-6 lg:grid-cols-2">

            <ActivityPanel />

            <AIAssistant />

          </section>

        </div>

      </main>

    </div>
  );
}


// ========================
// Main Application
// ========================

function App() {
  const { theme } = useTheme();

  return (
    <AuthGate>
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

      {/* Main Application Area */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden scroll-smooth">
        <Routes>

          {/* Dashboard */}
          <Route
            path="/dashboard"
            element={<Dashboard />}
          />

          {/* AI Chat */}
          <Route
            path="/chat"
            element={<ChatPage />}
          />

          {/* Knowledge */}
          <Route
            path="/knowledge"
            element={<KnowledgePage />}
          />

          {/* Documents */}
          <Route
            path="/documents"
            element={<DocumentsPage />}
          />

          {/* Projects */}
          <Route
            path="/projects"
            element={<ProjectsPage />}
          />

          {/* Agents */}
          <Route
            path="/agents"
            element={<AgentsPage />}
          />

          {/* Settings */}
          <Route
            path="/settings"
            element={<SettingsPage />}
          />

          {/* Root */}
          <Route
            path="/"
            element={
              <Navigate
                to="/dashboard"
                replace
              />
            }
          />

          {/* 404 */}
          <Route
            path="*"
            element={<NotFoundPage />}
          />

          {/* Help Page */}
          <Route
            path="/help"
            element={<HelpPage />}
          />

        </Routes>
      </div>
    </div>
    </AuthGate>
  );
}

export default App;