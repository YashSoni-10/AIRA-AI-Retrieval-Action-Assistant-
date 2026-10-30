import React, { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";

// ── Professional SVG Icons (Replacing emoji characters) ──────────────────────

function IconSearch({ className = "h-5 w-5", ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function IconCircleHelp({ className = "h-6 w-6", ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconRocket({ className = "h-5 w-5", ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

function IconSparkles({ className = "h-5 w-5", ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  );
}

function IconBookOpen({ className = "h-5 w-5", ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function IconFileText({ className = "h-5 w-5", ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

function IconZap({ className = "h-5 w-5", ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function IconFolderKanban({ className = "h-5 w-5", ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      <path d="M8 10v4" />
      <path d="M12 10v2" />
      <path d="M16 10v6" />
    </svg>
  );
}

function IconArrowRight({ className = "h-4 w-4", ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function IconX({ className = "h-4 w-4", ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ── Content Types & Definitions ───────────────────────────────────────────────

interface HelpTopic {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: "cyan" | "violet" | "emerald" | "blue" | "pink";
  route: string;
  actionText: string;
  keywords: string[];
  overview: string;
  steps: { title: string; detail: string }[];
  tips: string[];
}

interface FaqItem {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
}

const HELP_TOPICS: HelpTopic[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    description: "Learn the basics of AIRA and set up your workspace.",
    icon: IconRocket,
    accentColor: "cyan",
    route: "/dashboard",
    actionText: "Go to Dashboard",
    keywords: ["getting started", "setup", "workspace", "onboarding", "basics", "quickstart", "navigation", "start"],
    overview: "Get familiar with AIRA's AI-driven retrieval, multi-agent execution, and document reasoning capabilities in your workspace.",
    steps: [
      {
        title: "Explore the Dashboard",
        detail: "Review real-time workspace health, recent conversations, active tasks, and team metrics from your central dashboard.",
      },
      {
        title: "Add Documents & Knowledge",
        detail: "Upload PDF, Markdown, or text documents to populate your workspace's semantic search and RAG knowledge base.",
      },
      {
        title: "Chat with AIRA",
        detail: "Ask questions, query your documents, or instruct specialized agents to execute complex technical tasks.",
      },
    ],
    tips: [
      "Toggle between dark and light themes using the sidebar controls.",
      "Workspace admins can invite and manage teammates under User Management.",
    ],
  },
  {
    id: "using-aira",
    title: "Using AIRA",
    description: "Learn how to ask questions and get better AI answers.",
    icon: IconSparkles,
    accentColor: "cyan",
    route: "/chat",
    actionText: "Open AI Chat",
    keywords: ["using aira", "chat", "ask", "questions", "prompts", "rag", "citations", "export", "markdown", "json", "assistant"],
    overview: "Harness AIRA's conversational assistant powered by hybrid vector search, citation transparency, and multi-format chat exports.",
    steps: [
      {
        title: "Prompting AIRA",
        detail: "Ask natural language questions about your uploaded workspace documents, technical code, or project milestones.",
      },
      {
        title: "Verify Source Citations",
        detail: "Inspect highlighted citation badges, similarity scores, and original document excerpts alongside every answer.",
      },
      {
        title: "Export Conversations",
        detail: "Click Export in the chat header to download full conversation threads formatted as Markdown (.md) or JSON (.json).",
      },
    ],
    tips: [
      "Use specific keywords from your documents to help vector retrieval pinpoint relevant sections.",
      "Clear or rename conversations to keep your chat history organized.",
    ],
  },
  {
    id: "knowledge-base",
    title: "Knowledge Base",
    description: "Understand knowledge sources, search and AI retrieval.",
    icon: IconBookOpen,
    accentColor: "violet",
    route: "/knowledge",
    actionText: "Explore Knowledge",
    keywords: ["knowledge base", "knowledge", "sources", "retrieval", "hybrid search", "indexing", "bm25", "embeddings", "vector", "qdrant"],
    overview: "The Knowledge Base integrates document collections, external connectors, and vector embeddings into a high-speed retrieval engine.",
    steps: [
      {
        title: "Semantic Indexing",
        detail: "Documents are processed, divided into contextual chunks, and embedded into vector storage for sub-second retrieval.",
      },
      {
        title: "Hybrid Search Pipeline",
        detail: "Combines dense semantic vectors with sparse BM25 keyword matching and Reciprocal Rank Fusion (RRF) for optimal accuracy.",
      },
      {
        title: "Inspect Vector Store Health",
        detail: "Check collection chunk counts, indexing statuses, and retrieval diagnostics directly from the Knowledge page.",
      },
    ],
    tips: [
      "Re-indexing happens automatically when new documents are uploaded.",
      "Supported formats include PDF, TXT, MD, and RST.",
    ],
  },
  {
    id: "documents",
    title: "Documents",
    description: "Upload, manage and search documents in your workspace.",
    icon: IconFileText,
    accentColor: "emerald",
    route: "/documents",
    actionText: "Manage Documents",
    keywords: ["documents", "upload", "files", "pdf", "text", "search", "manage", "preview", "delete", "file management"],
    overview: "Centralize your organization's documentation with automated text extraction, instant previewing, and workspace-level scoping.",
    steps: [
      {
        title: "Uploading Files",
        detail: "Drag and drop or browse to upload PDF, TXT, MD, or RST files up to your workspace's configured size limit.",
      },
      {
        title: "Preview & Inspection",
        detail: "Click Preview on any document card to inspect parsed text chunks and verify indexing without leaving the page.",
      },
      {
        title: "Workspace Scoping",
        detail: "All uploaded documents are isolated to your workspace and accessible to authorized team members according to their role.",
      },
    ],
    tips: [
      "Admins can configure maximum file size and allowed extensions in Settings.",
      "Deleting a document also removes its embedded chunks from the vector store.",
    ],
  },
  {
    id: "ai-agents",
    title: "AI Agents",
    description: "Learn how AIRA agents reason and perform tasks.",
    icon: IconZap,
    accentColor: "blue",
    route: "/agents",
    actionText: "Launch AI Agents",
    keywords: [
      "ai agents",
      "agents",
      "task agent",
      "task agent works",
      "task execution",
      "reasoning",
      "tools",
      "autonomous",
      "tasks",
      "workflow",
      "langgraph",
    ],
    overview: "AIRA includes specialized autonomous agents capable of multi-step reasoning, goal decomposition, and task board execution.",
    steps: [
      {
        title: "Task Agent Execution",
        detail: "The Task Agent analyzes user goals, formulates structured step-by-step action plans, and creates or updates workspace tasks.",
      },
      {
        title: "Research & Synthesis",
        detail: "Agents automatically cross-reference workspace documents and web resources to synthesize comprehensive answers.",
      },
      {
        title: "Real-Time Execution Logs",
        detail: "Follow the live execution stream, tool calls, and intermediate reasoning steps in the Agents console.",
      },
    ],
    tips: [
      "Viewers have read-only access to tasks assigned to them.",
      "Admins and Members can dispatch agents to create, update, and manage tasks.",
    ],
  },
  {
    id: "projects",
    title: "Projects",
    description: "Organize work, tasks and project-related knowledge.",
    icon: IconFolderKanban,
    accentColor: "pink",
    route: "/projects",
    actionText: "View Projects",
    keywords: ["projects", "organize", "work", "kanban", "tasks", "collaboration", "team", "milestones", "github"],
    overview: "Projects unify documents, agent tasks, and team discussions around targeted deliverables, milestones, and shared repositories.",
    steps: [
      {
        title: "Project Spaces",
        detail: "Group related documents and chat threads into focused project workspaces for clean knowledge isolation.",
      },
      {
        title: "Task Coordination",
        detail: "Link agent workflows and manual team to-dos directly to project boards to track real-time delivery status.",
      },
      {
        title: "GitHub Synchronization",
        detail: "Connect your GitHub repositories to track issues, pull requests, and codebase context within project views.",
      },
    ],
    tips: [
      "Keep project descriptions detailed so AI agents can tailor their contextual reasoning.",
      "Use the Tasks page to filter assigned items by project.",
    ],
  },
];

const FAQS: FaqItem[] = [
  {
    id: "faq-what-can-i-ask",
    question: "What can I ask AIRA?",
    answer:
      "You can ask questions about information available in your connected workspace knowledge sources, query uploaded documents, generate structured summaries, and delegate multi-step technical workflows to specialized AI agents.",
    keywords: ["ask", "questions", "prompts", "summary", "capabilities", "chat", "what can i ask"],
  },
  {
    id: "faq-how-documents-used",
    question: "How does AIRA use my documents?",
    answer:
      "When you upload documents, AIRA parses and divides them into semantic chunks, generates dense vector embeddings, and indexes them using a hybrid search pipeline (Qdrant vectors + BM25 sparse lexical matching). When you ask questions, relevant passages are retrieved and cited with confidence scores.",
    keywords: ["documents", "indexing", "embeddings", "rag", "privacy", "qdrant", "bm25", "hybrid search"],
  },
  {
    id: "faq-what-are-agents",
    question: "What are AI Agents and how does the Task Agent work?",
    answer:
      "AI Agents are autonomous assistants that combine LLM reasoning with workspace tools. The Task Agent breaks down high-level user instructions into ordered sub-tasks, queries relevant workspace documents, and executes actions while streaming live progress updates, tool invocations, and execution logs.",
    keywords: [
      "task agent",
      "task agent works",
      "how does the task agent work",
      "ai agents",
      "what are ai agents",
      "tools",
      "reasoning",
      "execution",
    ],
  },
  {
    id: "faq-permissions",
    question: "How do workspace permissions and roles work?",
    answer:
      "AIRA supports three role tiers: Admin, Member, and Viewer. Admins have complete control over workspace settings, user activation, and role assignments. Members can upload documents, create tasks, and run agents. Viewers have read-only access to workspace resources and tasks assigned to them.",
    keywords: ["permissions", "roles", "admin", "member", "viewer", "rbac", "access control", "security"],
  },
  {
    id: "faq-export-chats",
    question: "How can I export my chat conversations?",
    answer:
      "In the AI Chat page, click the Export dropdown in the upper right header to download your entire conversation thread as either a Markdown (.md) document with citations or a structured JSON (.json) file.",
    keywords: ["export", "markdown", "json", "download", "save", "chat export"],
  },
  {
    id: "faq-github-integration",
    question: "How do I connect GitHub repositories?",
    answer:
      "Visit the GitHub page from the sidebar to connect your GitHub account via OAuth. Once connected, AIRA can read repository structures, inspect pull requests, and use your codebase as a rich knowledge source for technical questions.",
    keywords: ["github", "git", "repositories", "oauth", "connect", "code", "issues"],
  },
];

export default function HelpPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();

  // Search state
  const [searchQuery, setSearchQuery] = useState("");

  // Detail modal state for Help Topics
  const [activeTopic, setActiveTopic] = useState<HelpTopic | null>(null);

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveTopic(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Filter topics and FAQs based on search query
  const { filteredTopics, filteredFaqs, hasResults } = useMemo(() => {
    const raw = searchQuery.trim().toLowerCase();
    if (!raw) {
      return {
        filteredTopics: HELP_TOPICS,
        filteredFaqs: FAQS,
        hasResults: true,
      };
    }

    // Clean punctuation from query for tokenization
    const q = raw.replace(/[?.,!/\\#$%^&*;:{}=\-_`~()]/g, " ").trim();
    const tokens = q.split(/\s+/).filter(Boolean);

    const matchesTopic = (topic: HelpTopic) => {
      const text = [
        topic.title,
        topic.description,
        ...topic.keywords,
      ]
        .join(" ")
        .toLowerCase();

      // Direct match of the full query string
      if (text.includes(q)) return true;
      if (topic.keywords.some((k) => k.includes(q) || q.includes(k))) return true;

      // When multiple tokens are provided, require all tokens to match the topic's context
      if (tokens.length > 1) {
        return tokens.every((token) => text.includes(token));
      }

      // Single token match
      return tokens.some((token) => text.includes(token));
    };

    const matchesFaq = (faq: FaqItem) => {
      const text = [
        faq.question,
        faq.answer,
        ...faq.keywords,
      ]
        .join(" ")
        .toLowerCase();

      if (text.includes(q)) return true;
      if (faq.keywords.some((k) => k.includes(q) || q.includes(k))) return true;

      if (tokens.length > 1) {
        return tokens.every((token) => text.includes(token));
      }

      return tokens.some((token) => text.includes(token));
    };

    const matchingTopics = HELP_TOPICS.filter(matchesTopic);
    const matchingFaqs = FAQS.filter(matchesFaq);

    return {
      filteredTopics: matchingTopics,
      filteredFaqs: matchingFaqs,
      hasResults: matchingTopics.length > 0 || matchingFaqs.length > 0,
    };
  }, [searchQuery]);

  return (
    <div className="flex min-h-full flex-1 flex-col pt-16 md:pt-0">
      {/* Page Header */}
      <div
        className={`border-b px-5 py-5 backdrop-blur-xl transition-colors duration-300 sm:px-8 ${
          isDark
            ? "border-white/10 bg-[#090b15]/80 text-white"
            : "border-slate-200/80 bg-white/80 text-slate-900 shadow-sm"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
              Help & Support
            </h2>
            <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
              Find answers, learn AIRA features, and get assistance with your workspace
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main
        className={`relative flex-1 px-5 py-6 transition-colors duration-300 sm:px-8 sm:py-8 ${
          isDark ? "bg-[#060812]" : "bg-slate-50"
        }`}
      >
        <div className="mx-auto max-w-6xl space-y-8">
          {/* Hero Banner with Search */}
          <section
            className={`relative overflow-hidden rounded-2xl border p-6 shadow-2xl backdrop-blur-xl transition-colors duration-300 sm:p-8 ${
              isDark
                ? "border-white/10 bg-gradient-to-r from-[#10152b] via-[#0b0e1d] to-[#070914]"
                : "border-blue-100 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white"
            }`}
          >
            {isDark && (
              <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-cyan-500/0 via-cyan-400/40 via-blue-400/40 to-indigo-500/0" />
            )}

            <div className="relative z-10">
              <div className="flex items-center gap-4">
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${
                    isDark
                      ? "border-cyan-400/30 bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.2)]"
                      : "border-white/30 bg-white/20 text-white backdrop-blur-md"
                  }`}
                  aria-hidden="true"
                >
                  <IconCircleHelp className="h-6 w-6" />
                </div>

                <div>
                  <h1 className="text-xl font-extrabold text-white sm:text-2xl">
                    How can we{" "}
                    <span
                      className={
                        isDark
                          ? "bg-gradient-to-r from-cyan-300 via-blue-300 to-indigo-300 bg-clip-text text-transparent"
                          : "text-cyan-200"
                      }
                    >
                      help you
                    </span>
                    ?
                  </h1>

                  <p className={`mt-1 text-sm ${isDark ? "text-zinc-400" : "text-blue-100"}`}>
                    Search help topics, FAQs, and documentation across your workspace.
                  </p>
                </div>
              </div>

              {/* Working Search Field */}
              <div
                className={`mt-6 flex items-center gap-3 rounded-xl border p-2.5 shadow-xl backdrop-blur-xl transition ${
                  isDark
                    ? "border-white/10 bg-zinc-950/60 focus-within:border-cyan-400/60 focus-within:ring-1 focus-within:ring-cyan-400/20"
                    : "border-white/30 bg-white/20 text-white focus-within:border-white focus-within:ring-1 focus-within:ring-white/30"
                }`}
              >
                <span className={`pl-2 ${isDark ? "text-cyan-400" : "text-cyan-200"}`} aria-hidden="true">
                  <IconSearch className="h-5 w-5" />
                </span>

                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search for help (e.g. Task agent works?, documents, permissions)..."
                  aria-label="Search help topics and FAQs"
                  className={`min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm outline-none ${
                    isDark
                      ? "text-white placeholder:text-zinc-500"
                      : "text-white placeholder:text-blue-100"
                  }`}
                />

                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search input"
                    className={`mr-1 rounded-lg p-1.5 transition ${
                      isDark
                        ? "text-zinc-400 hover:bg-white/10 hover:text-white"
                        : "text-blue-200 hover:bg-white/20 hover:text-white"
                    }`}
                  >
                    <IconX className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Active Search Filter Badge */}
              {searchQuery && (
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className={isDark ? "text-cyan-400" : "text-cyan-100"}>
                    {hasResults
                      ? `Found ${filteredTopics.length} topic${
                          filteredTopics.length === 1 ? "" : "s"
                        } and ${filteredFaqs.length} FAQ${filteredFaqs.length === 1 ? "" : "s"}`
                      : "No matches found"}
                  </span>

                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className={`font-semibold underline transition ${
                      isDark ? "text-zinc-400 hover:text-white" : "text-blue-100 hover:text-white"
                    }`}
                  >
                    Reset filter
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Empty State when Search Yields No Results */}
          {!hasResults && (
            <div
              className={`rounded-2xl border p-8 text-center backdrop-blur-2xl ${
                isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white shadow-sm"
              }`}
            >
              <div
                className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border ${
                  isDark
                    ? "border-cyan-400/20 bg-cyan-500/10 text-cyan-400"
                    : "border-blue-200 bg-blue-50 text-blue-600"
                }`}
              >
                <IconSearch className="h-7 w-7" />
              </div>
              <h3 className={`mt-4 text-base font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                No results found for &ldquo;{searchQuery}&rdquo;
              </h3>
              <p
                className={`mx-auto mt-2 max-w-md text-sm leading-relaxed ${
                  isDark ? "text-zinc-400" : "text-slate-500"
                }`}
              >
                We couldn&apos;t find any topics or FAQs matching your query. Check for spelling
                errors, try broader terms like &ldquo;agent&rdquo;, &ldquo;document&rdquo;, or clear
                your search to view all resources.
              </p>
              <div className="mt-5 flex justify-center">
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition ${
                    isDark
                      ? "bg-white/10 text-white hover:bg-white/20"
                      : "bg-slate-200 text-slate-800 hover:bg-slate-300"
                  }`}
                >
                  Clear search
                </button>
              </div>
            </div>
          )}

          {/* Help Topics Section */}
          {filteredTopics.length > 0 && (
            <section>
              <div>
                <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                  Help Topics
                </h2>
                <p className={`mt-1 text-sm ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
                  Learn how to use different parts of AIRA.
                </p>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredTopics.map((topic) => {
                  const Icon = topic.icon;
                  return (
                    <div
                      key={topic.id}
                      className={`flex flex-col justify-between rounded-2xl border p-5 backdrop-blur-2xl transition-all hover:-translate-y-1 hover:shadow-xl ${
                        isDark
                          ? "border-white/15 bg-white/[0.04] hover:border-cyan-500/40 hover:bg-white/[0.07]"
                          : "border-slate-200 bg-white hover:border-blue-400/50 hover:bg-slate-50 shadow-sm"
                      }`}
                    >
                      <div>
                        {/* Topic Icon */}
                        <div
                          className={`flex h-11 w-11 items-center justify-center rounded-xl border ${
                            topic.accentColor === "cyan"
                              ? isDark
                                ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-300"
                                : "border-blue-200 bg-blue-50 text-blue-600"
                              : topic.accentColor === "violet"
                              ? isDark
                                ? "border-violet-400/30 bg-violet-500/10 text-violet-300"
                                : "border-purple-200 bg-purple-50 text-purple-600"
                              : topic.accentColor === "emerald"
                              ? isDark
                                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                                : "border-emerald-200 bg-emerald-50 text-emerald-600"
                              : topic.accentColor === "blue"
                              ? isDark
                                ? "border-blue-400/30 bg-blue-500/10 text-blue-300"
                                : "border-blue-200 bg-blue-50 text-blue-600"
                              : isDark
                              ? "border-pink-400/30 bg-pink-500/10 text-pink-300"
                              : "border-pink-200 bg-pink-50 text-pink-600"
                          }`}
                          aria-hidden="true"
                        >
                          <Icon className="h-5 w-5" />
                        </div>

                        {/* Title & Description */}
                        <h3 className={`mt-4 font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                          {topic.title}
                        </h3>

                        <p
                          className={`mt-2 text-sm leading-6 ${
                            isDark ? "text-zinc-400" : "text-slate-500"
                          }`}
                        >
                          {topic.description}
                        </p>
                      </div>

                      {/* Working Learn More Button */}
                      <button
                        type="button"
                        onClick={() => setActiveTopic(topic)}
                        className={`mt-4 inline-flex items-center gap-1.5 text-sm font-semibold transition self-start ${
                          isDark
                            ? "text-cyan-400 hover:text-cyan-300"
                            : "text-blue-600 hover:text-blue-700"
                        }`}
                        aria-haspopup="dialog"
                      >
                        <span>Learn more</span>
                        <IconArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Frequently Asked Questions Section */}
          {filteredFaqs.length > 0 && (
            <section
              className={`rounded-2xl border p-5 backdrop-blur-2xl shadow-xl sm:p-6 ${
                isDark ? "border-white/15 bg-white/[0.04]" : "border-slate-200 bg-white shadow-sm"
              }`}
            >
              <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                Frequently Asked Questions
              </h2>

              <div className={`mt-5 divide-y ${isDark ? "divide-white/10" : "divide-slate-200"}`}>
                {filteredFaqs.map((faq) => (
                  <details key={faq.id} className="group py-4">
                    <summary
                      className={`cursor-pointer list-none text-sm font-semibold transition hover:text-cyan-400 focus:outline-none flex items-center justify-between ${
                        isDark ? "text-zinc-200" : "text-slate-800"
                      }`}
                    >
                      <span>{faq.question}</span>
                      <span
                        className={`ml-3 transition-transform duration-200 group-open:rotate-90 ${
                          isDark ? "text-zinc-400" : "text-slate-400"
                        }`}
                        aria-hidden="true"
                      >
                        <IconArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </summary>

                    <p
                      className={`mt-3 text-sm leading-relaxed ${
                        isDark ? "text-zinc-400" : "text-slate-600"
                      }`}
                    >
                      {faq.answer}
                    </p>
                  </details>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      {/* ── Topic Detail Modal (Learn more) ──────────────────────────────────── */}
      {activeTopic && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="topic-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn"
          onClick={() => setActiveTopic(null)}
        >
          <div
            className={`relative max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border p-6 shadow-2xl backdrop-blur-2xl transition ${
              isDark
                ? "border-cyan-500/30 bg-[#0c1020] text-zinc-100"
                : "border-slate-200 bg-white text-slate-900"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b pb-4 border-white/10">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-xl border ${
                    isDark
                      ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-300"
                      : "border-blue-200 bg-blue-50 text-blue-600"
                  }`}
                  aria-hidden="true"
                >
                  <activeTopic.icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 id="topic-modal-title" className="text-lg font-bold">
                    {activeTopic.title}
                  </h3>
                  <p className={`text-xs ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
                    {activeTopic.description}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveTopic(null)}
                aria-label="Close dialog"
                className={`rounded-lg p-1.5 transition ${
                  isDark
                    ? "text-zinc-400 hover:bg-white/10 hover:text-white"
                    : "text-slate-400 hover:bg-slate-100 hover:text-slate-800"
                }`}
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="mt-5 space-y-6">
              {/* Overview */}
              <div>
                <h4 className={`text-xs font-bold uppercase tracking-wider ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                  Overview
                </h4>
                <p className={`mt-2 text-sm leading-relaxed ${isDark ? "text-zinc-300" : "text-slate-700"}`}>
                  {activeTopic.overview}
                </p>
              </div>

              {/* Step-by-Step Instructions */}
              <div>
                <h4 className={`text-xs font-bold uppercase tracking-wider ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                  How to Use &amp; Key Steps
                </h4>
                <div className="mt-3 space-y-3">
                  {activeTopic.steps.map((step, idx) => (
                    <div
                      key={step.title}
                      className={`flex gap-3 rounded-xl border p-3.5 ${
                        isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                          isDark
                            ? "bg-cyan-500/20 text-cyan-300 border border-cyan-400/30"
                            : "bg-blue-100 text-blue-700 border border-blue-200"
                        }`}
                      >
                        {idx + 1}
                      </div>
                      <div>
                        <p className={`text-sm font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
                          {step.title}
                        </p>
                        <p className={`mt-0.5 text-xs leading-relaxed ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                          {step.detail}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Best Practices & Tips */}
              <div>
                <h4 className={`text-xs font-bold uppercase tracking-wider ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                  Pro Tips
                </h4>
                <ul className="mt-2 space-y-1.5">
                  {activeTopic.tips.map((tip) => (
                    <li
                      key={tip}
                      className={`flex items-start gap-2 text-xs leading-relaxed ${
                        isDark ? "text-zinc-400" : "text-slate-600"
                      }`}
                    >
                      <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${isDark ? "bg-cyan-400" : "bg-blue-600"}`} />
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="mt-6 flex items-center justify-end gap-3 border-t pt-4 border-white/10">
              <button
                type="button"
                onClick={() => setActiveTopic(null)}
                className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                  isDark
                    ? "bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Close
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTopic(null);
                  navigate(activeTopic.route);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-md transition hover:brightness-110"
              >
                <span>{activeTopic.actionText}</span>
                <IconArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
