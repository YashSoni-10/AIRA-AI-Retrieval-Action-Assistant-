# AIRA (AI Retrieval & Action Assistant) — Comprehensive Manual Testing Guide

This manual testing guide is designed for testing and demonstrating the complete AIRA system before college faculty and placement evaluators. Every test case references real routes, UI controls, API endpoints, and behaviors implemented in the repository.

---

## 1. Prerequisites & Environment Setup

AIRA consists of three coordinated services and two data stores:
1. **Frontend**: React 18 + TypeScript + Vite (Port `5173`)
2. **Backend**: Express + Node.js + Mongoose + JWT (Port `5000`)
3. **AI Service**: FastAPI + LangGraph + SentenceTransformers + BM25 + Qdrant (Port `8000`)
4. **Primary Database**: MongoDB (Default: `mongodb://localhost:27017/aira` or Atlas cluster)
5. **Vector Store**: Qdrant Vector Engine (Default: `http://localhost:6333`)

### System Requirements
- Node.js v18+ and npm
- Python 3.10+ (with virtual environment in `Ai-Service/venv`)
- MongoDB (running locally or MongoDB Atlas connection string)
- Qdrant (Docker or standalone executable)

---

## 2. Environment Variables Configuration

Copy `.env.example` templates to `.env` in the respective directories:

### Backend (`backend/.env`)
```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/aira
JWT_SECRET=your_super_secret_jwt_key_at_least_32_characters_long
JWT_EXPIRE=15m
REFRESH_SECRET=your_super_secret_refresh_key_at_least_32_characters_long
REFRESH_EXPIRE=7d
COOKIE_SAMESITE=lax
COOKIE_SECURE=false
FRONTEND_ORIGIN=http://localhost:5173
FRONTEND_URL=http://localhost:5173

# Optional: GitHub Integration (Demo fallback active if omitted)
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:5000/api/github/oauth/callback

# Optional: Email Service (Dev console fallback active if omitted)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM="AIRA <noreply@aira.dev>"
EMAIL_VERIFICATION_EXPIRE_HOURS=24
```

### AI Service (`Ai-Service/.env`)
```env
APP_NAME=AIRA-Ai-Service
DEBUG=True
JWT_SECRET=your_super_secret_jwt_key_at_least_32_characters_long
QDRANT_HOST=localhost
QDRANT_PORT=6333
QDRANT_COLLECTION=aira_knowledge_base
GROQ_API_KEY=your_groq_api_key_here
NODE_BACKEND_URL=http://localhost:5000
CROSS_ENCODER_MODEL=cross-encoder/ms-marco-MiniLM-L-6-v2
```

---

## 3. Starting the Services

Open **3 separate terminal windows** inside the project root (`D:\Coding\Aira\AIRA-AI-Retrieval-Action-Assistant-`):

### Terminal 1: Backend (Express)
```powershell
cd backend
npm run dev
```
- **Expected Console Output**:
  - `Server running on port 5000`
  - `MongoDB Connected: ...` (or in-memory database fallback notification)

### Terminal 2: AI Service (FastAPI)
```powershell
cd Ai-Service
.\venv\Scripts\uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
- **Expected Console Output**:
  - `Uvicorn running on http://127.0.0.1:8000`
  - `Application startup complete.`

### Terminal 3: Frontend (React + Vite)
```powershell
cd frontend
npm run dev
```
- **Expected Console Output**:
  - `VITE v8.2.2 ready in ... ms`
  - `Local: http://localhost:5173/`

---

## 4. Service Health Verification

Before logging in, verify service health:
- **FastAPI Health Check**: Open `http://127.0.0.1:8000/api/v1/health` in your browser.
  - Expected: `{"status":"healthy","service":"AIRA AI Service","database":{"status":"connected",...}}`
- **Node Backend Check**: Open `http://localhost:5000/api/workspace/me` (unauthenticated).
  - Expected: `{"success":false,"message":"Not authorized to access this route"}`
- **Settings Page Health Lights**: Once signed in, navigate to **Settings** (`/settings`) and scroll to **Service Status**:
  - AI Service (FastAPI): Green dot (`Online`)
  - Auth Service (Node.js): Green dot (`Online`)
  - Frontend (React + Vite): Green dot (`Online`)

---

## 5. Test Accounts and Role Strategy

For demonstration purposes, prepare three user accounts:
1. **Admin**: `admin@test.com` (Full system and user management access)
2. **Member**: `member@test.com` (Normal workspace access, create/edit tasks, upload/delete own documents)
3. **Viewer**: `viewer@test.com` (Read-only access, cannot create/delete tasks or documents)

> **Note**: To create these accounts, register them normally via the UI registration screen. To make `admin@test.com` an admin, you can set `role: "admin"` directly in MongoDB or use the admin promotion endpoint.

---

## 6. Manual Test Scenarios

---

### Test Suite 1: Authentication, Registration & Email Verification (Phase 6C)

#### 1.1 New User Registration & Check Your Inbox
- **Steps**:
  1. Navigate to `http://localhost:5173/`.
  2. Click the **Register** tab.
  3. Enter Name: `Alice Student`, Email: `alice@college.edu`, Password: `Password123!`.
  4. Click **Create Account**.
- **Expected Result**:
  - User is created and immediately transitioned to the **Check your inbox** screen.
  - UI displays an envelope icon, "Check your inbox", and references `alice@college.edu`.
  - Backend console displays: `[sendEmailVerification] SMTP not configured. Verification link for alice@college.edu: http://localhost:5173/verify-email?token=<token>`.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

#### 1.2 Unverified Banner in Workspace
- **Steps**:
  1. On the "Check your inbox" screen, click **Continue to Workspace**.
  2. Look at the top of the main view above Dashboard.
- **Expected Result**:
  - A prominent amber notification banner appears: `Verify your email: A verification link was sent to alice@college.edu. Please verify your address to secure your account.`
  - A **Resend Email** button and an **✕** dismiss button are visible.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

#### 1.3 Resend Verification Email Action
- **Steps**:
  1. Click the **Resend Email** button on the banner.
- **Expected Result**:
  - Button state changes to "Sending...", then updates to `Verification link sent! Check your inbox.` in green.
  - Backend console outputs a fresh verification link.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

#### 1.4 Invalid or Expired Verification Link
- **Steps**:
  1. Navigate to `http://localhost:5173/verify-email?token=invalid_or_fake_token_12345`.
- **Expected Result**:
  - Loading spinner displays briefly ("Verifying your email...").
  - Transitions to error screen: `Verification failed` with message `The verification link is invalid, expired, or has already been used.`
  - An inline "Request a new verification link" form is available with an email field and resend button.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

#### 1.5 Successful Verification
- **Steps**:
  1. Copy the real token URL from the backend terminal logs (e.g., `http://localhost:5173/verify-email?token=<valid_token>`).
  2. Paste it into the browser address bar and press Enter.
- **Expected Result**:
  - Loading spinner shows briefly.
  - Transitions to green checkmark screen: `Email verified! Your account is confirmed and fully verified.`
  - A **Continue to Workspace** button appears.
  - Clicking "Continue to Workspace" returns to the dashboard; the unverified amber banner is now **permanently gone**.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

#### 1.6 Single-Use Enforcement
- **Steps**:
  1. Refresh the verification page with the same token, or paste the same URL again.
- **Expected Result**:
  - Shows error screen: `Verification token is invalid, expired, or has already been used.` (Single-use token invalidation verified).
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

---

### Test Suite 2: JWT Silent Refresh & Token Lifecycle (Phase 6A)

#### 2.1 Silent Refresh on Expiry
- **Steps**:
  1. Log into AIRA.
  2. Open Developer Tools (F12) → **Application** tab → **Cookies** (`http://localhost:5000`).
  3. Verify `aira_refresh` cookie exists with flags: `HttpOnly: true`, `SameSite: Lax`, `Path: /api/auth`.
  4. In Developer Tools → **Console**, simulate access token expiration:
     ```javascript
     localStorage.setItem("aira_token", "stale_or_expired_jwt_token");
     ```
  5. Click any navigation link (e.g. **Tasks** or **Documents**).
  6. Look at the **Network** tab.
- **Expected Result**:
  - The request to `/api/tasks` returns `401 Unauthorized`.
  - Frontend `authRequest` automatically intercepts the 401 and calls `POST http://localhost:5000/api/auth/refresh`.
  - The refresh endpoint verifies `aira_refresh` cookie and returns a fresh `token`.
  - The original request to `/api/tasks` is retried automatically with the new Bearer token and returns `200 OK`.
  - The user remains logged in without interruption or page flicker.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

#### 2.2 Per-Session Logout
- **Steps**:
  1. Click **Sign Out** from the user dropdown or **Settings** page.
- **Expected Result**:
  - `aira_token` and `aira_user` are cleared from `localStorage`.
  - Network tab shows `POST /api/auth/logout`.
  - The `aira_refresh` cookie is cleared (expiry set in past).
  - App redirects to login page.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

---

### Test Suite 3: Password Reset Flow (Phase 6B)

#### 3.1 Forgot Password Request
- **Steps**:
  1. On the Login page (`/`), click **Forgot your password?**.
  2. Enter: `alice@college.edu`.
  3. Click **Send reset link**.
- **Expected Result**:
  - Shows success card: `Check your inbox. If alice@college.edu is registered, a reset link has been sent.`
  - Backend console outputs: `[forgotPassword] SMTP not configured. Reset link for alice@college.edu: http://localhost:5173/reset-password?token=...`.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

#### 3.2 Reset Password & Auto Sign-In
- **Steps**:
  1. Copy the reset link from the backend console and paste into browser.
  2. Enter New Password: `NewSecretPassword456!`.
  3. Enter Confirm Password: `NewSecretPassword456!`.
  4. Click **Reset password**.
- **Expected Result**:
  - Shows checkmark: `Password updated! Redirecting you to the dashboard…`.
  - Automatically signs in with fresh access and refresh tokens, loading the workspace.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

---

### Test Suite 4: Role-Based Access Control & User Activation (Phases 1A & 2A)

#### 4.1 Admin User Management Screen
- **Steps**:
  1. Sign in as Admin (`admin@test.com`).
  2. Click **User Management** in the sidebar.
- **Expected Result**:
  - User table lists all workspace accounts with Name, Email, Workspace, Role, and Status.
  - Active users display a green `Active` badge.
  - Admin users display a role dropdown and status toggle button.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

#### 4.2 Deactivate User & Enforce Login Block
- **Steps**:
  1. Locate `alice@college.edu` in the User Management table.
  2. Click the **Deactivate** button.
  3. Confirm the dialog prompt.
  4. Verify the badge changes to amber `Inactive` and the button changes to `Activate`.
  5. In an incognito window, attempt to log in as `alice@college.edu`.
- **Expected Result**:
  - Login fails with error: `Account deactivated. Please contact your workspace administrator.`
  - Token is not issued.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

#### 4.3 Re-activate User & Last Admin Protection
- **Steps**:
  1. Click **Activate** on `alice@college.edu` → verify status returns to `Active`.
  2. Attempt to deactivate your own admin account.
  3. Attempt to demote the sole active admin to `member`.
- **Expected Result**:
  - Self-deactivation button is hidden for current user (`(Current You)`).
  - Admin demotion is disabled or blocked with message: `Cannot demote the sole active administrator in this workspace`.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

#### 4.4 Viewer Role Restrictions
- **Steps**:
  1. Log in as Viewer (`viewer@test.com`).
  2. Observe the sidebar and pages.
- **Expected Result**:
  - Sidebar shows **Projects** and **GitHub** for read-only viewing.
  - **User Management** is not in sidebar (admin-only).
  - On **Documents** page: File upload dropzone is hidden, delete buttons are hidden.
  - On **Tasks** page: "+ New Task" button is hidden, task status edit and delete buttons are hidden.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

---

### Test Suite 5: Workspace Settings (Phase 2B)

#### 5.1 Admin Workspace Configuration
- **Steps**:
  1. Log in as Admin.
  2. Navigate to **Settings** (`/settings`).
  3. Scroll to the **Workspace** section.
  4. Edit Workspace Name: `AIRA Engineering Labs`.
  5. Adjust Max upload size slider to `25 MB`.
  6. Check allowed file types: `.pdf`, `.txt`, `.md`.
  7. Click **Save Workspace**.
- **Expected Result**:
  - Green confirmation appears: `Workspace settings saved ✓`.
  - Refresh the page: the updated name `AIRA Engineering Labs` and settings persist.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

---

### Test Suite 6: Tasks Management & Assignment (Phase 3)

#### 6.1 Task Creation with Assignee
- **Steps**:
  1. Navigate to **Tasks** (`/tasks`).
  2. Click **+ New Task**.
  3. Enter Title: `Implement RAG Benchmarking`, Priority: `High`, Status: `In Progress`.
  4. Open the **Assignee** dropdown: verify workspace members are listed.
  5. Select `Alice Student` (or any member).
  6. Click **Create Task**.
- **Expected Result**:
  - Task card appears in the list with `HIGH` badge, `In Progress` badge, and assigned user name.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

#### 6.2 Task Search & Filter
- **Steps**:
  1. In the search bar on the Tasks page, type: `Benchmarking`.
- **Expected Result**:
  - List filters in real-time (after 300ms debounce) showing only matching tasks.
  - Clear the search input: full task list returns.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

---

### Test Suite 7: Document Management, Preview & Hybrid Search (Phase 4)

#### 7.1 Document Upload & Ingestion Status
- **Steps**:
  1. Navigate to **Documents** (`/documents`).
  2. Upload a sample PDF or Markdown file (e.g. `README.md` or a project report).
- **Expected Result**:
  - Upload shows "Processing document and generating vector embeddings...".
  - Shows success banner: `✅ Indexed X vectors from "filename"`.
  - Document card displays filename, `INDEXED` status badge, chunk count, vector count, and file size.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

#### 7.2 Secure Document Preview (Phase 4C)
- **Steps**:
  1. On the document card, click **👁 Preview**.
- **Expected Result**:
  - Expands preview panel with spinner: `Loading document preview from knowledge base...`.
  - Renders the reconstructed text chunks extracted during ingestion in a formatted preview box.
  - Click **Hide Preview**: panel collapses cleanly.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

#### 7.3 Knowledge Search & Top-K Slider (Phase 4B)
- **Steps**:
  1. Navigate to **Knowledge** (`/knowledge`).
  2. Enter a keyword from your uploaded document.
  3. Drag the **Results** slider to `3`.
  4. Click **Search**.
- **Expected Result**:
  - Returns exactly top 3 chunks with filename, excerpt, and match confidence / rank badge.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

---

### Test Suite 8: Chat, Citations, Export & Multi-Turn Context (Phase 5A)

#### 8.1 Grounded Chat with Citations
- **Steps**:
  1. Navigate to **Chat** (`/chat`).
  2. Submit a query related to your uploaded document (e.g., `What are the core features of AIRA?`).
- **Expected Result**:
  - Response streams smoothly using SSE.
  - Step-by-step reasoning steps are expandable.
  - Response includes verifiable source citation cards displaying filename, page/chunk number, and relevance match score.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

#### 8.2 Multi-Turn Context
- **Steps**:
  1. Immediately follow up in the same conversation: `Can you elaborate on the second point you just mentioned?`.
- **Expected Result**:
  - AIRA answers accurately referencing the previous turn context from the conversation history in MongoDB.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

#### 8.3 Chat Export to Markdown & JSON (Phase 5A)
- **Steps**:
  1. Click the **Export** button at the top of the chat panel.
  2. Select **Export as Markdown (.md)**.
  3. Select **Export as JSON (.json)**.
- **Expected Result**:
  - Browser downloads `<title>_<date>.md` and `<title>_<date>.json`.
  - Markdown file contains full headings, user messages, assistant responses, confidence scores, and all source citations.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

---

### Test Suite 9: LangGraph Autonomous Agents & Persistent History (Phase 5B)

#### 9.1 Knowledge Agent Execution
- **Steps**:
  1. Navigate to **Agents** (`/agents`).
  2. Select **Knowledge Agent**.
  3. Enter Query: `Summarize our uploaded architecture documents`.
  4. Click **Execute Agent**.
- **Expected Result**:
  - Status indicator shows execution progress.
  - LangGraph StateGraph executes tool calls (`search_knowledge`).
  - Returns structured synthesis with reasoning steps, tool calls, and citations.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

#### 9.2 Task Agent Auto-Creation
- **Steps**:
  1. Select **Task Agent**.
  2. Enter Query: `Create a high priority task to audit the MongoDB indexes by Friday`.
  3. Click **Execute Agent**.
- **Expected Result**:
  - Agent executes tool call `create_task`.
  - Output displays: `Task Created Successfully` with Title and Priority.
  - Switch to **Tasks** (`/tasks`) page: the task created by the agent appears in MongoDB and the task list!
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

#### 9.3 Persistent Agent History (Phase 5B)
- **Steps**:
  1. On the **Agents** page, observe the **Execution History** panel below the query box.
  2. Refresh the browser (`F5`).
- **Expected Result**:
  - Execution history is restored from MongoDB; previous agent runs, tool calls, and answers remain intact across reloads and sessions.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

---

### Test Suite 10: Avatar Upload & Profile Management (Phase 6D)

#### 10.1 Avatar Upload & Display
- **Steps**:
  1. Navigate to **Settings** (`/settings`).
  2. Hover over your avatar image in the Profile section and click the edit icon (✎).
  3. Select a `.png` or `.jpg` image from your computer.
- **Expected Result**:
  - Uploads via `POST /api/auth/avatar`.
  - Shows `Avatar updated ✓`.
  - The new avatar renders immediately in the profile card and header across the application.
- **Status**: [ ] PASS  [ ] FAIL
- **Observations**: _________________________________________________

---

### Test Suite 11: End-to-End Smoke Test (The "Presentation Demo Run")

Execute this complete 7-step journey for your faculty evaluation:

| Step | Action | Expected Outcome | Pass/Fail |
| :--- | :--- | :--- | :--- |
| **1. Register** | Register a new user `demo@aira.edu` | Shows "Check your inbox" screen; token logged in dev terminal. | [ ] |
| **2. Verify** | Open verification URL with token | Green checkmark, email marked verified, unverified banner disappears. | [ ] |
| **3. Ingest** | Upload project specification document | Document processed, chunked, and vectors stored in Qdrant; card shows metadata. | [ ] |
| **4. Preview** | Click Preview on document card | Document chunks preview rendered inside collapsible container. | [ ] |
| **5. RAG Chat**| Ask a question in Chat about the document | Streaming answer, reasoning trace, and clickable source citations with match confidence. | [ ] |
| **6. Agent** | Run Task Agent: `Create a task to review documentation` | Agent invokes `create_task`; task appears automatically in Tasks page. | [ ] |
| **7. Export** | Click Export in Chat → Download Markdown | Clean Markdown document downloaded with complete dialogue and references. | [ ] |

---

## 7. Troubleshooting & FAQ

| Problem | Likely Cause | Solution |
| :--- | :--- | :--- |
| **"Auth backend not connected" banner** | Node.js backend on port 5000 is stopped or crashed | Run `cd backend && npm run dev`. Verify `JWT_SECRET` is set in `backend/.env`. |
| **AI Service health light is Red** | FastAPI service on port 8000 is not running | Run `cd Ai-Service && .\venv\Scripts\uvicorn app.main:app --port 8000`. |
| **Qdrant connection error during upload** | Qdrant vector engine is not running | Start Qdrant Docker container or local Qdrant server on port 6333. |
| **"Too many requests" (HTTP 429)** | Rate limiter triggered (e.g. resend verification or login) | Wait 15 minutes, or adjust `RATE_LIMIT_*_MAX` in `backend/.env`. |
| **Emails not arriving in real inbox** | SMTP credentials omitted | This is expected in development. The system safely logs all verification and reset links to the backend terminal console. |

---
