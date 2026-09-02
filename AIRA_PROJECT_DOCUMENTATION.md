# AIRA - AI-Powered Enterprise Work Assistant
## Complete Project Documentation

AIRA (AI Research & Intelligence Assistant) is a full-stack enterprise AI platform that allows teams to upload documents, search their organizational knowledge base, and get grounded AI answers with citations -- powered by a Python FastAPI backend and a React 19 frontend.

---

## Table of Contents

1. Project Overview
2. Architecture
3. Technology Stack
4. Project Structure
5. Backend - Python AI Service
6. Frontend - React Application
7. API Reference
8. Environment Variables
9. Running the Project
10. Git & Version Control
11. What Was Built - Session Log

---

## 1. Project Overview

AIRA solves a core enterprise problem: information is scattered across PDFs, wikis, and documents -- and finding the right answer takes too long.

AIRA solves this by:
- Ingesting any PDF, Markdown, or TXT document and converting it into searchable vector embeddings
- Answering questions using a Retrieval-Augmented Generation (RAG) pipeline grounded in your actual documents
- Providing citations -- every answer links back to the exact source chunk it was derived from
- Running AI Agents -- specialized agents for Knowledge lookup, Engineering tasks, and Project management

---

## 2. Architecture

React 19 + Vite Frontend (http://localhost:5173)
         |
         | HTTP / REST API
         v
Python FastAPI AI Service (http://localhost:8000)
         |
   Services Layer:
   document_processor -> embeddings_service -> vector_store
                   rag_engine <- llm_service
                      agent_service
         |
         v
   Qdrant Vector DB (in-memory fallback if unavailable)
         |
         v
   LLM Provider:
   - Groq API (primary) - Llama 3.1 8B Instant
   - Gemini API (fallback) - Gemini 1.5 Flash

---

## 3. Technology Stack

### Backend
| Technology            | Version | Purpose                              |
|-----------------------|---------|--------------------------------------|
| Python                | 3.13    | Runtime                              |
| FastAPI               | 0.141+  | Web framework & async API            |
| Uvicorn               | 0.52+   | ASGI server                          |
| Pydantic              | 2.x     | Data validation & schemas            |
| Groq SDK              | 1.7+    | Primary LLM (Llama 3.1 8B Instant)   |
| Google Generative AI  | 0.8+    | Fallback LLM (Gemini 1.5 Flash)      |
| Sentence Transformers | 6.0+    | all-MiniLM-L6-v2 embeddings          |
| Qdrant Client         | 1.19+   | Vector database                      |
| PyPDF                 | 6.x     | PDF text extraction                  |
| python-dotenv         | 1.x     | Environment variable loading         |
| NumPy / scikit-learn  | latest  | Vector math utilities                |

### Frontend
| Technology      | Version | Purpose                        |
|-----------------|---------|--------------------------------|
| React           | 19.x    | UI framework                   |
| TypeScript      | 6.x     | Type safety                    |
| Vite            | 8.x     | Build tool & dev server        |
| React Router DOM| 7.x     | Client-side routing            |
| Tailwind CSS    | 4.x     | Utility-first styling          |
| Vanilla CSS     | -       | Custom animations/glassmorphism|

---

## 4. Project Structure

D:\Aira\
|-- Ai-Service\                          Python FastAPI AI Backend
|   |-- .env                             API keys (Groq, Gemini) -- DO NOT COMMIT
|   |-- requirements.txt                 Python dependencies
|   |-- venv\                            Python virtual environment
|   -- app\
|       |-- __init__.py
|       |-- main.py                      FastAPI app entry point
|       |-- core\
|       |   |-- __init__.py
|       |   -- config.py               Settings loaded from .env
|       |-- api\
|       |   -- v1\
|       |       |-- __init__.py
|       |       |-- router.py           Central API router
|       |       -- endpoints\
|       |           |-- __init__.py
|       |           |-- health.py       GET /api/v1/health
|       |           |-- ingest.py       POST /api/v1/ingest (file upload)
|       |           |-- chat.py         POST /api/v1/chat (RAG Q&A)
|       |           |-- search.py       GET /api/v1/search (semantic search)
|       |           -- agents.py       GET/POST /api/v1/agents
|       -- services\
|           |-- __init__.py
|           |-- llm_service.py          Unified Groq/Gemini LLM client
|           |-- document_processor.py   Text extraction & chunking
|           |-- embeddings_service.py   Sentence-transformer embeddings
|           |-- vector_store.py         Qdrant + in-memory vector store
|           |-- rag_engine.py           Full RAG pipeline
|           -- agent_service.py        AI Agent workforce logic
|
-- frontend\                            React 19 + Vite Frontend
    |-- index.html                       HTML entry point
    |-- vite.config.ts                   Vite build configuration
    |-- tsconfig.json                    TypeScript config (root)
    |-- tsconfig.app.json                TypeScript config (app)
    |-- tsconfig.node.json               TypeScript config (node/vite)
    |-- package.json                     NPM dependencies & scripts
    |-- eslint.config.js                 ESLint rules
    |-- public\
    |   |-- favicon.svg                  Browser tab icon
    |   -- icons.svg                    SVG icon sprite
    -- src\
        |-- main.tsx                     React DOM entry point
        |-- App.tsx                      Root component & routing
        |-- App.css                      Global app styles
        |-- index.css                    Tailwind base + custom CSS
        |-- assets\
        |   |-- hero.png                 Hero section image
        |   |-- react.svg
        |   -- vite.svg
        |-- context\
        |   -- ThemeContext.tsx         Global dark/light theme state
        |-- components\
        |   |-- Sidebar.tsx              Left navigation sidebar
        |   |-- Header.tsx               Top header bar
        |   |-- SearchBox.tsx            Global search input
        |   |-- StatsCard.tsx            Dashboard metrics card
        |   |-- ActivityPanel.tsx        Recent activity feed
        |   -- AIAssistant.tsx          Floating AI assistant widget
        |-- pages\
        |   |-- ChatPage.tsx             AI Chat - RAG Q&A interface (LIVE)
        |   |-- DocumentsPage.tsx        Document upload & management (LIVE)
        |   |-- KnowledgePage.tsx        Knowledge base explorer
        |   |-- AgentsPage.tsx           AI Agents management
        |   |-- ProjectsPage.tsx         Projects dashboard
        |   |-- SettingsPage.tsx         Account & workspace settings
        |   |-- HelpPage.tsx             Help & documentation
        |   -- NotFoundPage.tsx         404 fallback page
        -- services\
            -- api.ts                   Typed HTTP client for FastAPI backend

---

## 5. Backend - Python AI Service

### app/main.py
PURPOSE: FastAPI application entry point.
- Creates the FastAPI app with title, version, and Swagger docs
- Adds CORS middleware to allow requests from React (http://localhost:5173)
- Mounts all API routes under /api/v1 prefix
- Logs startup info: LLM provider, API key status, docs URL
- Exposes root GET / endpoint returning service info

### app/core/config.py
PURPOSE: Centralized settings loaded from .env file.
- LLM_PROVIDER: "groq" or "gemini"
- GROQ_API_KEY / GEMINI_API_KEY: LLM authentication
- GROQ_MODEL: llama-3.1-8b-instant (default)
- GEMINI_MODEL: gemini-1.5-flash (default)
- QDRANT_HOST/PORT/COLLECTION: Vector DB config
- EMBEDDING_MODEL/EMBEDDING_DIM: Sentence transformer settings
- CHUNK_SIZE/CHUNK_OVERLAP: Document chunking parameters

### app/services/llm_service.py
PURPOSE: Unified LLM interface with provider switching and fallback.

Key function: get_llm_response(system_prompt, user_prompt, max_tokens)

Provider routing logic:
  1. If LLM_PROVIDER=groq AND GROQ_API_KEY is set -> Groq API (Llama 3.1 8B)
  2. Else if LLM_PROVIDER=gemini AND GEMINI_API_KEY is set -> Gemini API
  3. Else -> Local fallback message telling user to set API keys

All LLM calls use temperature=0.3 for consistent, factual responses.

### app/services/document_processor.py
PURPOSE: Extract and chunk text from uploaded documents.

extract_text(file_bytes, filename):
  - .pdf  -> pypdf.PdfReader, preserves page numbers
  - .md, .txt, .rst -> UTF-8 decode

chunk_text(text, filename, chunk_size=500, chunk_overlap=50):
  - Splits text into overlapping semantic chunks
  - Tries to break at natural boundaries (paragraphs, sentences)
  - Returns: [{text, filename, chunk_index, char_start, char_end}]

### app/services/embeddings_service.py
PURPOSE: Generate vector embeddings using sentence-transformers.

- Model: all-MiniLM-L6-v2 (384-dimensional embeddings)
- Singleton loader: model loaded once at startup, reused for all requests
- embed_texts(texts): batch embedding -> list[list[float]]
- embed_query(query): single query embedding (normalized for cosine sim)

### app/services/vector_store.py
PURPOSE: Qdrant vector database integration with in-memory fallback.

Connection strategy:
  - Tries to connect to Qdrant at localhost:6333
  - If Qdrant unavailable -> silently switches to in-memory store
  - Auto-creates Qdrant collection "aira_knowledge" if missing

Key functions:
  - add_documents(chunks): embeds + upserts to Qdrant or memory store
  - similarity_search(query, top_k): returns top-K nearest chunks with scores
  - delete_documents(filename): removes all vectors for a file
  - get_document_count(): total indexed vector count
  - list_documents(): list of unique indexed filenames

### app/services/rag_engine.py
PURPOSE: Full Retrieval-Augmented Generation pipeline.

run_rag_query(query, top_k) pipeline steps:
  1. Semantic Retrieval: similarity_search() for top-K chunks
  2. Context Building: formats chunks with source labels + relevance scores
  3. Prompt Engineering: grounded system prompt + user prompt
  4. LLM Generation: get_llm_response() with context-enriched prompt
  5. Confidence Scoring: avg of top-3 retrieval similarities
  6. Citation Formatting: packages chunk metadata as citation objects

Returns:
  {
    "answer": "...",
    "confidence": 0.87,
    "confidence_label": "High",
    "reasoning_steps": ["step 1", ...],
    "citations": [{"filename": "...", "chunk_index": 0, "excerpt": "...", "score": 0.92}],
    "chunks_found": 5
  }

Confidence Labels: High >= 75% | Medium >= 45% | Low < 45%

### app/services/agent_service.py
PURPOSE: Stateful AI Agent workforce with tool-calling capabilities.

Available Agents:
  - knowledge  : Knowledge Agent  - Document search & retrieval
  - engineering: Engineering Agent - Technical queries & code
  - task       : Task Agent        - Task creation & project mgmt

Built-in Tools:
  - tool_search_knowledge(query): searches vector store
  - tool_summarize_document(filename): summarizes a specific document
  - tool_create_task(title, description, priority): creates task (simulated)
  - tool_answer_question(question): general LLM answer without RAG

execute_agent(agent_id, query) flow:
  1. Searches knowledge base for context
  2. Builds enriched prompt with agent system instructions
  3. Calls LLM for final answer
  4. Task agent auto-creates task if query contains action keywords
  5. Returns steps taken, answer, and knowledge results

### app/api/v1/endpoints/health.py
ROUTE: GET /api/v1/health
PURPOSE: Service health check endpoint.
Response: { status, service, version, llm_provider, indexed_vectors }

### app/api/v1/endpoints/ingest.py
ROUTES:
  POST   /api/v1/ingest           - Upload & index a document
  GET    /api/v1/ingest/list      - List all indexed files
  DELETE /api/v1/ingest/{filename} - Remove a document

Upload constraints: PDF, TXT, MD, RST | Max 10 MB

### app/api/v1/endpoints/chat.py
ROUTE: POST /api/v1/chat
PURPOSE: RAG-powered question answering.
Request:  { query: string, top_k: int }
Response: { answer, confidence, confidence_label, reasoning_steps, citations, chunks_found, query }

### app/api/v1/endpoints/search.py
ROUTE: GET /api/v1/search?q=<query>&top_k=<n>
PURPOSE: Raw semantic search without LLM generation.
Response: { query, results: [{text, filename, chunk_index, score}], count }

### app/api/v1/endpoints/agents.py
ROUTES:
  GET  /api/v1/agents         - List all available agents
  POST /api/v1/agents/execute - Execute an agent

Execute request:  { agent_id: string, query: string }
Execute response: { agent_id, agent_name, steps, answer, task_created, knowledge_results, status }

### app/api/v1/router.py
PURPOSE: Central router that mounts all endpoint routers under /api/v1.

---

## 6. Frontend - React Application

### index.html
Root HTML file. Loads Vite-bundled React app. Sets meta tags and favicon.

### src/main.tsx
React DOM entry point. Wraps <App /> in <ThemeProvider> and <BrowserRouter>.

### src/App.tsx
Root React component. Defines all routes:
  /            -> Dashboard (Sidebar + Header + Stats + Activity + AIAssistant)
  /chat        -> ChatPage
  /knowledge   -> KnowledgePage
  /documents   -> DocumentsPage
  /projects    -> ProjectsPage
  /agents      -> AgentsPage
  /settings    -> SettingsPage
  /help        -> HelpPage
  *            -> NotFoundPage (404)

### src/context/ThemeContext.tsx
PURPOSE: Global dark/light mode state management.
- Provides: theme ("dark" | "light") and toggleTheme()
- Persists preference to localStorage
- Applies dark/light class to document root

### src/components/Sidebar.tsx
PURPOSE: Left navigation sidebar with links to all pages.
- AIRA logo/branding, navigation links, highlights active route
- Responsive: collapses on mobile

### src/components/Header.tsx
PURPOSE: Top header bar on the dashboard.
- Workspace name, user avatar, notification bell

### src/components/SearchBox.tsx
PURPOSE: Global search input for the dashboard.
- Keyboard shortcut hint (Ctrl+K), glassmorphism styling

### src/components/StatsCard.tsx
PURPOSE: Metric card showing KPIs on the dashboard.
- Props: title, value, change %, icon, color

### src/components/ActivityPanel.tsx
PURPOSE: Recent activity feed on the dashboard.
- Recent uploads, queries, agent executions with timestamps

### src/components/AIAssistant.tsx
PURPOSE: Floating AI assistant widget on the dashboard.
- Quick question panel without navigating to Chat page

### src/pages/ChatPage.tsx
PURPOSE: Main AI Chat interface -- the core user-facing feature.
CONNECTED TO: POST /api/v1/chat (LIVE API)

Features:
  - Full chat conversation UI with message history
  - LIVE RAG integration -- real Groq/Gemini responses
  - Confidence badge (High/Medium/Low) on AI responses
  - Reasoning steps showing how the answer was derived
  - Source citations with filename, chunk index, relevance score
  - Voice input using Web Speech API (SpeechRecognition)
  - Suggestion chips for quick queries
  - Auto-scroll to latest message
  - Clear conversation button

State:
  - messages: conversation history including RAG metadata
  - isThinking: shows animated typing indicator
  - isListening: voice input active state

### src/pages/DocumentsPage.tsx
PURPOSE: Document upload and knowledge base management.
CONNECTED TO: /api/v1/ingest (POST, GET, DELETE) (LIVE API)

Features:
  - Drag & drop file upload zone
  - Live upload to POST /api/v1/ingest with FormData
  - Shows upload success with vector count
  - Fetches real document list from GET /api/v1/ingest/list on load
  - Delete documents from knowledge base
  - Search/filter documents by name
  - Supported: PDF, TXT, MD (max 10 MB)

### src/pages/KnowledgePage.tsx
PURPOSE: Knowledge base explorer and search interface.
- Browse indexed knowledge organized by category
- Semantic search within the knowledge base

### src/pages/AgentsPage.tsx
PURPOSE: AI Agents management and execution dashboard.
- Lists all 3 agents: Knowledge, Engineering, Task
- Shows agent capabilities and tools

### src/pages/ProjectsPage.tsx
PURPOSE: Projects dashboard.
- Lists workspace projects with stats and status

### src/pages/SettingsPage.tsx
PURPOSE: Account and workspace settings.
- User profile fields (Full Name, Role)

### src/pages/HelpPage.tsx
PURPOSE: Help center and documentation.
- FAQ, keyboard shortcuts, support links

### src/pages/NotFoundPage.tsx
PURPOSE: 404 error page for unmatched routes.

### src/services/api.ts
PURPOSE: Centralized, strongly-typed HTTP client for FastAPI backend.
BASE URL: http://localhost:8000/api/v1

Exported Types:
  - ChatResponse      : Full RAG response with answer, confidence, citations
  - Citation          : Source reference (filename, chunk_index, excerpt, score)
  - IngestResponse    : Upload result with chunk/vector counts
  - SearchResponse    : Semantic search results
  - AgentInfo         : Agent metadata
  - AgentExecuteResponse: Agent execution result with steps
  - HealthResponse    : Server health data

Exported Functions:
  checkHealth()                     GET  /health        Check server status
  sendChatMessage(query, top_k)     POST /chat          RAG Q&A
  ingestDocument(file)              POST /ingest        Upload file
  listDocuments()                   GET  /ingest/list   List indexed files
  deleteDocument(filename)          DELETE /ingest/{}   Remove file
  searchKnowledge(query, top_k)     GET  /search        Semantic search
  getAgents()                       GET  /agents        List agents
  executeAgent(agent_id, query)     POST /agents/execute Run agent

---

## 7. API Reference

Base URL: http://localhost:8000/api/v1
Swagger UI: http://localhost:8000/docs
ReDoc:      http://localhost:8000/redoc

| Method | Endpoint               | Description                           |
|--------|------------------------|---------------------------------------|
| GET    | /health                | Server health + LLM provider info     |
| POST   | /ingest                | Upload and index a document           |
| GET    | /ingest/list           | List all indexed documents            |
| DELETE | /ingest/{filename}     | Remove a document from index          |
| POST   | /chat                  | RAG question answering with citations |
| GET    | /search?q=...&top_k=.. | Raw semantic search                   |
| GET    | /agents                | List available AI agents              |
| POST   | /agents/execute        | Execute an AI agent                   |

---

## 8. Environment Variables

File: D:\Aira\Ai-Service\.env

LLM_PROVIDER=groq              # "groq" or "gemini"
GROQ_API_KEY=gsk_xxxxxxxxxxxx  # Your Groq API key
GEMINI_API_KEY=AIzaxxxxxxxxxx  # Your Gemini API key
GROQ_MODEL=llama-3.1-8b-instant
GEMINI_MODEL=gemini-1.5-flash
QDRANT_HOST=localhost
QDRANT_PORT=6333
QDRANT_COLLECTION=aira_knowledge
EMBEDDING_MODEL=all-MiniLM-L6-v2
CHUNK_SIZE=500
CHUNK_OVERLAP=50
FRONTEND_ORIGIN=http://localhost:5173

WARNING: Never commit .env to git. It contains private API keys.

---

## 9. Running the Project

### Prerequisites
- Python 3.13+
- Node.js 20+
- Git

### Step 1: Start the Python AI Backend
cd D:\Aira\Ai-Service
.\venv\Scripts\Activate
uvicorn app.main:app --reload --port 8000

Server: http://localhost:8000
Docs:   http://localhost:8000/docs

### Step 2: Start the React Frontend
cd D:\Aira\frontend
npm install        (first time only)
npm run dev

Frontend: http://localhost:5173

### Step 3: Use AIRA
1. Open http://localhost:5173
2. Go to Documents page -> upload a PDF or TXT file
3. Go to Chat page -> ask a question about the document
4. See grounded answer with confidence score and citations!

### Build for Production
cd D:\Aira\frontend
npm run build
# Output: D:\Aira\frontend\dist\

---

## 10. Git & Version Control

Active Branch: frontend

Key Commits:
  0915e5c  feat: build Python AI Service (FastAPI + RAG + Agents) and connect React frontend
  6efc9ad  feat: remove theme toggle button from all pages
  bd04328  Connect React Frontend (Chat & Documents pages) to Live Python AI Service
  0da8238  Add Specialized AI Agents Workforce Engine & Endpoint
  2eb6158  Add Grounded RAG Engine & Q&A Chat Endpoint

---

## 11. What Was Built - Session Log

### Phase 1: Python AI Service Foundation
- Set up FastAPI app with CORS middleware
- Created config.py for centralized env-based settings
- Built document_processor.py: PDF/TXT/MD extraction + semantic chunking

### Phase 2: Vector Store & Embeddings
- Integrated sentence-transformers (all-MiniLM-L6-v2) for 384-dim embeddings
- Built vector_store.py with Qdrant primary + in-memory fallback
- Auto-creates Qdrant collection "aira_knowledge" on startup

### Phase 3: RAG Engine & LLM Integration
- Built llm_service.py: unified Groq/Gemini API client with fallback
- Built rag_engine.py: full RAG pipeline with:
  * Semantic retrieval
  * Context-grounded prompting
  * Confidence score calculation
  * Source citation formatting

### Phase 4: AI Agent Workforce
- Built agent_service.py with 3 specialized agents
- Each agent has: system prompt, tools, stateful execution
- Knowledge Agent, Engineering Agent, Task Agent (auto-creates tasks)

### Phase 5: API Endpoints
- health.py: service health check
- ingest.py: file upload + chunk + embed + store pipeline
- chat.py: RAG Q&A with Pydantic response models
- search.py: direct semantic search endpoint
- agents.py: agent listing and execution

### Phase 6: React Frontend Integration
- Created src/services/api.ts: typed client for all FastAPI endpoints
- Updated ChatPage.tsx:
  * sendMessage is now async
  * Calls real POST /api/v1/chat
  * Shows confidence badges, reasoning steps, citations
  * Error handling with user-friendly messages
- Rebuilt DocumentsPage.tsx:
  * Real drag-and-drop file upload to /api/v1/ingest
  * Fetches actual indexed document list from API
  * Delete documents with one click
  * Upload success/error state feedback

### Phase 7: UI Polish - Theme Toggle Removal
- Removed theme toggle button from all 7 pages:
  AgentsPage, ChatPage, DocumentsPage, HelpPage,
  KnowledgePage, ProjectsPage, SettingsPage
- Cleaned up toggleTheme from all useTheme() destructuring

---

## Notes

- Qdrant is optional. If not running, the service uses in-memory store.
  Documents are lost on server restart without Qdrant.
  Install Qdrant for persistent vector storage.

- LLM fallback. If no API keys are set, responses are placeholder messages.

- Embedding model. First request downloads all-MiniLM-L6-v2 (~90 MB)
  from HuggingFace. Subsequent requests use the cached model instantly.

---

Documentation generated: 2026-08-31
Project: AIRA - AI Enterprise Work Assistant
Location: D:\Aira\

---

## 12. GitHub Integration

AIRA includes a robust GitHub integration that lets teams search workspace repositories, view active issues, track pull requests, and use AI Agents to reason about repository state.

### ⚙️ Backend Implementation

#### `app/services/github_service.py`
- Handles authenticated requests to the GitHub API using personal access tokens (`GITHUB_TOKEN`).
- **Graceful Fallback:** If `GITHUB_TOKEN` is not set, the service automatically falls back to returning structured mock repositories, issues, and PR data. This allows previewing features instantly without manual token setup.

#### `app/api/v1/endpoints/github.py`
- `GET /api/v1/github/repos` - Lists connected repositories.
- `GET /api/v1/github/issues?repo=<fullname>` - Lists open and closed issues for a repo.
- `GET /api/v1/github/pulls?repo=<fullname>` - Lists active and draft pull requests.

#### `app/services/agent_service.py` (Engineering Agent Extension)
- Exposes tools: `list_github_repos`, `get_github_issues`, and `get_github_pulls`.
- The **Engineering Agent** uses intent detection to automatically trigger these tools when a query contains keywords like "issue", "pr", "repository", or "github". The results are compiled directly into the LLM synthesis context.

### 🌐 Frontend Implementation

#### `src/services/api.ts`
- Added types: `GitHubRepo`, `GitHubIssue`, and `GitHubPullRequest`.
- Added query clients: `getGithubRepos()`, `getGithubIssues(repo?)`, and `getGithubPulls(repo?)`.

#### `src/pages/ProjectsPage.tsx` (Dynamic Projects Workspace)
- **Repository List Grid:** Replaced the hardcoded cards with a dynamic query mapping repos with languages, forks, stars, and open issues.
- **Interactive Details Board:** Clicking any project card fetches its live issues and pull requests, displayed side-by-side inside dedicated tabs.
- **Direct GitHub Access:** Direct link to the source repository on GitHub.

### 🔑 Environment Configuration
Add the following keys to your `Ai-Service/.env` to configure live GitHub integrations:
```env
# GitHub Token (Optional - fallbacks used if empty)
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
GITHUB_REPO=aira-workspace/AIRA
```
