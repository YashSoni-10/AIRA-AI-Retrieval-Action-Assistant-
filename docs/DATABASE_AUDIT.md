# AIRA — Database Audit
**Date:** 2026-09-09 | Source: `backend/src/models/User.js`, `Ai-Service/app/services/vector_store.py`

---

## 1. Actual Databases in Use

| Database | Technology | Purpose | When Used |
|----------|------------|---------|-----------|
| MongoDB | Mongoose 9 | User accounts | When `MONGO_URI` is configured and reachable |
| In-Memory JS Array | `memoryUsers[]` in authController.js | User accounts fallback | When MongoDB unavailable |
| Qdrant | qdrant-client 1.8+ | Document vector embeddings | When Qdrant running at localhost:6333 |
| In-Memory Python List | `_memory_store[]` in vector_store.py | Document vectors fallback | When Qdrant unavailable |

---

## 2. MongoDB — Users Collection

### Schema Definition (`User.js`)

```javascript
{
  name:      { type: String, required: true, trim: true },
  email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:  { type: String, required: true, minlength: 6, select: false },
  role:      { type: String, enum: ["admin", "member", "viewer"], default: "member" },
  avatar:    { type: String, default: "" },
  isActive:  { type: Boolean, default: true },
  createdAt: Date,  // auto via timestamps: true
  updatedAt: Date   // auto via timestamps: true
}
```

### Indexes
| Field | Index Type | Purpose |
|-------|-----------|---------|
| email | Unique Index | Prevent duplicate accounts |
| _id | Default Index | MongoDB document lookup |

> **Missing Index:** No index on `isActive` — if filtering active users at scale, this would be a full collection scan.

### Hooks
| Hook | Trigger | Action |
|------|---------|--------|
| `pre('save')` | Before save | Hash password with bcrypt (rounds=12) if modified |
| `toJSON()` | Serialization | Remove `password` field from output |

### Instance Methods
| Method | Implementation |
|--------|---------------|
| `comparePassword(candidate)` | `bcrypt.compare(candidate, this.password)` |

### Queries Used
| Operation | Method | Notes |
|-----------|--------|-------|
| Register | `User.create({ name, email, password, role })` | Password hashed by pre-save hook |
| Login | `User.findOne({ email }).select("+password")` | `.select("+password")` needed due to `select: false` |
| Get Me | `User.findById(userId)` | Password excluded by default |
| Update Profile | `User.findByIdAndUpdate(id, {...}, { new: true, runValidators: true })` | |
| Change Password | `User.findById(id).select("+password")` + `user.save()` | save() triggers pre-save hook to re-hash |

---

## 3. Qdrant — Vector Store (`aira_knowledge` Collection)

### Collection Configuration
```python
VectorParams(
    size=384,              # all-MiniLM-L6-v2 dimensions
    distance=Distance.COSINE
)
```

### Point (Vector) Structure
Each stored vector contains:
```json
{
  "id": "uuid-v4-string",
  "vector": [0.1, 0.2, ...],  // 384 floats
  "payload": {
    "text": "chunk text content",
    "filename": "document.pdf",
    "chunk_index": 0
  }
}
```

### Operations Used
| Operation | Qdrant Method | Notes |
|-----------|--------------|-------|
| Insert | `client.upsert(collection_name, points)` | UUIDs generated per chunk |
| Search | `client.search(collection_name, query_vector, limit, with_payload)` | Returns scored results |
| Delete by filename | `client.delete(collection_name, Filter(must=[FieldCondition(filename, MatchValue)]))` | Returns 1, not actual count |
| List all | `client.scroll(collection_name, limit=100, offset=None)` | Paginates 100 at a time |
| Count | `client.get_collection(name).points_count` | Total vector count |

### Missing Data in Payload
| Field | Status | Impact |
|-------|--------|--------|
| `text` | ✅ Stored | Can reconstruct chunks |
| `filename` | ✅ Stored | Can filter by document |
| `chunk_index` | ✅ Stored | Citation tracking |
| `char_start` | ❌ NOT stored | Cannot do precise text highlighting |
| `char_end` | ❌ NOT stored | Cannot do precise text highlighting |
| `upload_date` | ❌ NOT stored | Cannot sort by recency |
| `file_size_kb` | ❌ NOT stored | Cannot show file stats |
| `user_id` | ❌ NOT stored | No user/workspace isolation |
| `workspace_id` | ❌ NOT stored | No multi-tenant isolation |
| `page_number` | ❌ NOT stored | Cannot cite by page |

---

## 4. In-Memory Fallbacks

### `memoryUsers[]` (Node backend)
- Declared as module-level `const memoryUsers = [];` in `authController.js`
- Exported and imported by `middleware/auth.js`
- **Lost on every server restart** — not acceptable for production
- Used as automatic fallback when MongoDB connection fails

### `_memory_store[]` (Python AI service)
- Module-level `_memory_store: list[dict] = []`
- Activated when `_use_memory_fallback` is `True`
- `_use_memory_fallback` set to `True` on Qdrant connection failure
- **Once memory fallback is active, Qdrant is never retried** (stale flag, no retry logic)
- **Lost on every service restart**
- Similarity search uses numpy dot product (vectors are normalized, so this is cosine similarity)

---

## 5. Missing Database Models

The following data entities exist conceptually in the application but have **no database model**:

| Entity | Required For | Current State |
|--------|-------------|---------------|
| Document/File metadata | Document management, per-user files, upload history | Only stored as filename in Qdrant payload |
| Conversation | Chat history persistence | In-memory in browser only |
| Message | Conversation messages | In-memory in browser only |
| Workspace | Multi-tenant isolation | Not implemented |
| Task | Task agent "creates tasks" | Simulated — generated UUID, not persisted |
| AgentExecution | Agent execution history | Not persisted |

---

## 6. Data Quality Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| Duplicate ingestion | HIGH | Re-uploading same file creates duplicate vectors. No deduplication check. |
| No workspace isolation | HIGH | All users share `aira_knowledge` collection. User A's documents visible to User B. |
| No user ownership on vectors | HIGH | Any authenticated user can delete any other user's documents |
| Qdrant delete count | LOW | `delete_documents()` always returns `1` from Qdrant path — not actual count |
| Memory fallback flag | MEDIUM | Once Qdrant fails, never retried — could silently use memory after Qdrant recovers |
| Missing char_start/end | LOW | `document_processor.py` returns `char_start`/`char_end` in chunks but these are NOT stored in vector payload |

---

## 7. Recommended Additions

For Level 1/2 completion, the following schema additions are needed:

### MongoDB — Documents Collection (NEW)
```javascript
{
  userId: ObjectId (ref: User, required),
  filename: String (required),
  originalName: String,
  fileSize: Number,
  fileType: String,
  chunkCount: Number,
  vectorCount: Number,
  status: "processing" | "indexed" | "failed",
  uploadedAt: Date,
  workspaceId: String (for future multi-tenant)
}
```

### MongoDB — Conversations Collection (NEW)
```javascript
{
  userId: ObjectId (ref: User, required),
  title: String,
  messages: [{
    role: "user" | "assistant",
    content: String,
    citations: Array,
    confidence: Number,
    timestamp: Date
  }],
  createdAt: Date,
  updatedAt: Date
}
```

### Qdrant — Extended Payload (MODIFY)
```json
{
  "text": "...",
  "filename": "...",
  "chunk_index": 0,
  "user_id": "user-mongo-id",
  "upload_date": "ISO-timestamp",
  "page_number": 1
}
```
