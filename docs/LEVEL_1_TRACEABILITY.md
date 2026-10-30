# AIRA — Level 1 Traceability Matrix
**Date:** 2026-09-09 | LEVEL 1: Foundation & RAG

---

## Summary

| Requirement | Status |
|-------------|--------|
| Authentication | IMPLEMENTED |
| Workspace Foundation | PARTIALLY IMPLEMENTED |
| Document Ingestion | IMPLEMENTED |
| Text Extraction | IMPLEMENTED |
| Chunking | IMPLEMENTED |
| Embeddings | IMPLEMENTED |
| Vector Database | IMPLEMENTED |
| Semantic Search | IMPLEMENTED |
| RAG Pipeline | IMPLEMENTED |
| AI Chat | IMPLEMENTED |
| Source Citations | IMPLEMENTED |
| Conversation History | NOT IMPLEMENTED |

---

## Detailed Traceability

### 1. Authentication
| Aspect | Implementation File | Function/Class | API | Database | Frontend | Status |
|--------|-------------------|---------------|-----|----------|----------|--------|
| User registration | `authController.js` | `register()` | POST /api/auth/register | MongoDB User | `LoginPage.tsx` `register()` | **IMPLEMENTED** |
| User login | `authController.js` | `login()` | POST /api/auth/login | MongoDB User | `LoginPage.tsx` `login()` | **IMPLEMENTED** |
| JWT creation | `authController.js` | `signToken()` | — | — | `localStorage.setItem("aira_token")` | **IMPLEMENTED** |
| JWT verification | `middleware/auth.js` | `protect()` | All protected routes | MongoDB User | `auth.ts` Bearer header | **IMPLEMENTED** |
| Auth gate in frontend | `App.tsx` | `AuthGate` component | — | — | Wraps entire app | **IMPLEMENTED** |
| Logout | `services/auth.ts` | `logout()` | — (localStorage clear) | — | `SettingsPage.tsx` | **IMPLEMENTED** |

**Gap:** Auth gate checks token existence but does NOT validate token against server on page load — expired or invalid tokens only fail on first protected API call.

---

### 2. Workspace Foundation
| Aspect | Implementation File | Function/Class | API | Database | Frontend | Status |
|--------|-------------------|---------------|-----|----------|----------|--------|
| User profile | `User.js`, `authController.js` | `getMe()`, `updateProfile()` | GET/PATCH /api/auth/me | MongoDB User | `SettingsPage.tsx` | **IMPLEMENTED** |
| Multi-user support | `User.js` | Schema | — | MongoDB User | — | **IMPLEMENTED** |
| Workspace isolation | — | — | — | — | — | **NOT IMPLEMENTED** |
| Workspace model | — | — | — | — | — | **NOT IMPLEMENTED** |
| Per-user document isolation | — | — | — | Qdrant (no user_id in payload) | — | **NOT IMPLEMENTED** |

**Gap:** All documents are shared across all users. There is no workspace or per-user isolation in the vector store.

---

### 3. Document Ingestion
| Aspect | Implementation File | Function/Class | API | Database | Frontend | Status |
|--------|-------------------|---------------|-----|----------|----------|--------|
| File upload endpoint | `endpoints/ingest.py` | `ingest_document()` | POST /api/v1/ingest | Qdrant | `DocumentsPage.tsx` `ingestDocument()` | **IMPLEMENTED** |
| Upload UI (drag-drop) | `DocumentsPage.tsx` | Upload zone component | — | — | `DocumentsPage.tsx` | **IMPLEMENTED** |
| File type validation | `endpoints/ingest.py` | `ALLOWED_EXTENSIONS` set | — | — | Client-side file filter | **IMPLEMENTED** |
| File size limit | `endpoints/ingest.py` | `MAX_FILE_SIZE = 10MB` | — | — | — | **IMPLEMENTED** |
| List documents | `endpoints/ingest.py` | `list_indexed_documents()` | GET /api/v1/ingest/list | Qdrant | `DocumentsPage.tsx` | **IMPLEMENTED** |
| Delete document | `endpoints/ingest.py` | `delete_document()` | DELETE /api/v1/ingest/{fn} | Qdrant | `DocumentsPage.tsx` | **IMPLEMENTED** |
| Duplicate detection | — | — | — | — | — | **NOT IMPLEMENTED** |
| Document metadata persistence | — | — | — | — | — | **NOT IMPLEMENTED** (no MongoDB Document model) |

**Gap:** Re-uploading same file creates duplicate vectors with no warning. No Document model in MongoDB — only filenames stored in Qdrant payload.

---

### 4. Text Extraction
| Aspect | Implementation File | Function/Class | Input | Output | Status |
|--------|-------------------|---------------|-------|--------|--------|
| PDF extraction | `document_processor.py` | `_extract_pdf()` | PDF bytes | Text with `[Page N]` markers | **IMPLEMENTED** |
| TXT extraction | `document_processor.py` | `extract_text()` | TXT bytes | UTF-8 decoded text | **IMPLEMENTED** |
| MD extraction | `document_processor.py` | `extract_text()` | MD bytes | UTF-8 decoded text | **IMPLEMENTED** |
| RST extraction | `document_processor.py` | `extract_text()` | RST bytes | UTF-8 decoded text | **IMPLEMENTED** |
| Unknown type | `document_processor.py` | `extract_text()` | Bytes | UTF-8 decode attempt | **IMPLEMENTED** |
| OCR for scanned PDFs | — | — | — | — | **NOT IMPLEMENTED** |
| DOCX/XLSX extraction | — | — | — | — | **NOT IMPLEMENTED** |

**Gap:** Scanned PDFs (image-only) will extract empty text. No OCR. DOCX/XLSX not supported.

---

### 5. Chunking
| Aspect | Implementation File | Function/Class | Config | Status |
|--------|-------------------|---------------|--------|--------|
| Overlapping chunks | `document_processor.py` | `chunk_text()` | `chunk_size=500`, `chunk_overlap=50` | **IMPLEMENTED** |
| Sentence boundary detection | `document_processor.py` | `chunk_text()` | Tries `\n\n`, `. `, `? `, `! `, `\n`, ` ` | **IMPLEMENTED** |
| Chunk metadata | `document_processor.py` | `chunk_text()` | `text, filename, chunk_index, char_start, char_end` | **IMPLEMENTED** |
| Configurable size | `core/config.py` | `CHUNK_SIZE`, `CHUNK_OVERLAP` | Via `.env` | **IMPLEMENTED** |
| Semantic chunking | — | — | — | **NOT IMPLEMENTED** (char-based only) |

---

### 6. Embeddings
| Aspect | Implementation File | Function/Class | Model | Status |
|--------|-------------------|---------------|-------|--------|
| Embedding generation | `embeddings_service.py` | `embed_texts()` | all-MiniLM-L6-v2 | **IMPLEMENTED** |
| Query embedding | `embeddings_service.py` | `embed_query()` | all-MiniLM-L6-v2 | **IMPLEMENTED** |
| Normalization | `embeddings_service.py` | `normalize_embeddings=True` | — | **IMPLEMENTED** |
| Singleton model | `embeddings_service.py` | `_model` global | — | **IMPLEMENTED** |
| Batch processing | `embeddings_service.py` | `model.encode(texts)` | — | **IMPLEMENTED** |

---

### 7. Vector Database
| Aspect | Implementation File | Function/Class | Config | Status |
|--------|-------------------|---------------|--------|--------|
| Qdrant connection | `vector_store.py` | `_get_qdrant()` | `localhost:6333` | **IMPLEMENTED** |
| Collection auto-creation | `vector_store.py` | `_get_qdrant()` | `aira_knowledge` | **IMPLEMENTED** |
| In-memory fallback | `vector_store.py` | `_memory_store`, `_memory_add()` | — | **IMPLEMENTED** |
| Vector upsert | `vector_store.py` | `_qdrant_add()` | — | **IMPLEMENTED** |
| Vector persistence | Qdrant | — | On-disk when Qdrant running | **IMPLEMENTED** |
| Restart persistence | — | — | — | **PARTIAL** (only when Qdrant running; lost in memory mode) |

---

### 8. Semantic Search
| Aspect | Implementation File | Function/Class | Status |
|--------|-------------------|---------------|--------|
| Cosine similarity search | `vector_store.py` | `similarity_search()` | **IMPLEMENTED** |
| Top-K retrieval | `vector_store.py` | `top_k` parameter | **IMPLEMENTED** |
| Score normalization | `vector_store.py` | Cosine distance = score | **IMPLEMENTED** |
| Search API endpoint | `endpoints/search.py` | `search_knowledge()` | **IMPLEMENTED** |
| Frontend search | `KnowledgePage.tsx` | `searchKnowledge()` | **IMPLEMENTED** |
| Keyword search (BM25) | — | — | **NOT IMPLEMENTED** |
| Hybrid fusion | — | — | **NOT IMPLEMENTED** |

---

### 9. RAG Pipeline
| Aspect | Implementation File | Function/Class | Status |
|--------|-------------------|---------------|--------|
| Query → retrieval | `rag_engine.py` | `run_rag_query()` → `similarity_search()` | **IMPLEMENTED** |
| Context construction | `rag_engine.py` | Context string building | **IMPLEMENTED** |
| LLM grounding | `rag_engine.py` | System + user prompt | **IMPLEMENTED** |
| Confidence scoring | `rag_engine.py` | `avg(top3_scores) * 1.15` | **IMPLEMENTED** |
| Confidence labels | `rag_engine.py` | High/Medium/Low thresholds | **IMPLEMENTED** |
| Full pipeline endpoint | `endpoints/chat.py` | POST /api/v1/chat | **IMPLEMENTED** |
| Streaming variant | `endpoints/chat.py` | GET /api/v1/chat/stream | **PARTIALLY IMPLEMENTED** (simulated) |
| Conversation context | — | — | **NOT IMPLEMENTED** |

---

### 10. AI Chat
| Aspect | Implementation File | Function/Class | Status |
|--------|-------------------|---------------|--------|
| Chat UI | `ChatPage.tsx` | Full chat component | **IMPLEMENTED** |
| Send message | `ChatPage.tsx` | `sendMessage()` → `sendChatMessage()` | **IMPLEMENTED** |
| Thinking indicator | `ChatPage.tsx` | `isThinking` state | **IMPLEMENTED** |
| Voice input | `ChatPage.tsx` | Web Speech API `SpeechRecognition` | **IMPLEMENTED** |
| Message history (browser) | `ChatPage.tsx` | `messages` state | **IMPLEMENTED** |
| Message history (persistent) | — | — | **NOT IMPLEMENTED** |
| Suggestion chips | `ChatPage.tsx` | Quick query buttons | **IMPLEMENTED** |
| Clear conversation | `ChatPage.tsx` | `clearChat()` | **IMPLEMENTED** |

---

### 11. Source Citations
| Aspect | Implementation File | Function/Class | Status |
|--------|-------------------|---------------|--------|
| Citation extraction | `rag_engine.py` | Citation formatting | **IMPLEMENTED** |
| Citation fields | `rag_engine.py` | `filename, chunk_index, excerpt (200 chars), score` | **IMPLEMENTED** |
| Citation in response | `endpoints/chat.py` | `ChatResponse.citations` | **IMPLEMENTED** |
| Citation display | `ChatPage.tsx` | Citation cards in chat | **IMPLEMENTED** |
| Page number citation | — | — | **NOT IMPLEMENTED** |
| Character position citation | — | — | **NOT IMPLEMENTED** |

---

### 12. Conversation History
| Aspect | Implementation File | Function/Class | Status |
|--------|-------------------|---------------|--------|
| Browser session history | `ChatPage.tsx` | `messages` useState | **IMPLEMENTED** |
| Persistent history | — | — | **NOT IMPLEMENTED** |
| History API | — | — | **NOT IMPLEMENTED** |
| History UI | — | — | **NOT IMPLEMENTED** |
| Multi-turn context | — | — | **NOT IMPLEMENTED** (each query is independent) |

**Gap:** Each RAG query is completely independent. Prior messages in the UI are NOT sent as context to the LLM. Refreshing the page loses all conversation history.

---

## Level 1 Overall Completion

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Authentication | ✅ IMPLEMENTED |
| 2 | Workspace Foundation | ⚠️ PARTIALLY IMPLEMENTED |
| 3 | Document Ingestion | ✅ IMPLEMENTED |
| 4 | Text Extraction | ✅ IMPLEMENTED |
| 5 | Chunking | ✅ IMPLEMENTED |
| 6 | Embeddings | ✅ IMPLEMENTED |
| 7 | Vector Database | ✅ IMPLEMENTED |
| 8 | Semantic Search | ✅ IMPLEMENTED |
| 9 | RAG Pipeline | ✅ IMPLEMENTED |
| 10 | AI Chat | ✅ IMPLEMENTED |
| 11 | Source Citations | ✅ IMPLEMENTED |
| 12 | Conversation History | ❌ NOT IMPLEMENTED |

**Level 1 Core RAG Pipeline: FUNCTIONAL** (10/12 requirements implemented)

**Critical Missing:**
- Conversation history persistence
- Per-user document isolation (security issue that also makes it incomplete)

**Level 1 is functionally demonstrable** but architecturally incomplete for a production system (missing isolation and history).
