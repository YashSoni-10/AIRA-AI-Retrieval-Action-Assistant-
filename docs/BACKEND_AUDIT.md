# AIRA — Backend Audit (Node.js + Express)
**Date:** 2026-09-09 | Source: `backend/`

---

## 1. Server Configuration (`server.js`)

| Setting | Value |
|---------|-------|
| Framework | Express 5 |
| Port | `process.env.PORT` or `5000` |
| MongoDB URI | `process.env.MONGO_URI` or `mongodb://localhost:27017/aira` |
| CORS Origin | `process.env.FRONTEND_ORIGIN` or `http://localhost:5173` |
| DNS Override | Sets Google DNS `8.8.8.8` for MongoDB Atlas SRV resolution on Windows |
| DB Timeout | 10,000ms `serverSelectionTimeoutMS` |
| Fallback | Starts server even if MongoDB fails (uses in-memory fallback) |

---

## 2. Complete Endpoint Inventory

### `POST /api/auth/register`
| Field | Value |
|-------|-------|
| Auth Required | No |
| Role Required | None |
| Request Body | `{ name: string, email: string, password: string, role?: string }` |
| Response | `{ success: true, token: string, user: UserObject }` |
| Controller | `authController.js → register()` |
| Service | Mongoose `User.create()` or in-memory push |
| Database | MongoDB users collection / `memoryUsers[]` |
| Validation | Name + email + password presence check only (no email format regex, no password strength) |
| Error Handling | 400 missing fields, 409 duplicate email, 500 server error |
| Status | **IMPLEMENTED** |
| Test Status | **NOT TESTED** |

### `POST /api/auth/login`
| Field | Value |
|-------|-------|
| Auth Required | No |
| Role Required | None |
| Request Body | `{ email: string, password: string }` |
| Response | `{ success: true, token: string, user: UserObject }` |
| Controller | `authController.js → login()` |
| Service | `User.findOne()` + `bcrypt.compare()` |
| Database | MongoDB / `memoryUsers[]` |
| Validation | Email + password presence only |
| Error Handling | 400 missing fields, 401 wrong credentials, 500 server error |
| Status | **IMPLEMENTED** |
| Test Status | **NOT TESTED** |

### `GET /api/auth/me`
| Field | Value |
|-------|-------|
| Auth Required | Yes (JWT Bearer) |
| Role Required | None |
| Request Body | None |
| Response | `{ success: true, user: UserObject }` |
| Controller | `authController.js → getMe()` |
| Middleware | `protect` (JWT verification) |
| Database | MongoDB / `memoryUsers[]` |
| Error Handling | 401 no token, 401 invalid token, 404 user not found, 500 server error |
| Status | **IMPLEMENTED** |
| Test Status | **NOT TESTED** |

### `PATCH /api/auth/update-profile`
| Field | Value |
|-------|-------|
| Auth Required | Yes (JWT Bearer) |
| Role Required | None |
| Request Body | `{ name?: string, role?: string }` |
| Response | `{ success: true, user: UserObject }` |
| Controller | `authController.js → updateProfile()` |
| Database | MongoDB `findByIdAndUpdate()` / `memoryUsers[]` |
| Validation | No type check on role — any string accepted (should validate enum) |
| Error Handling | 401 not authed, 404 user not found, 500 server error |
| Status | **IMPLEMENTED** (minor validation gap) |
| Test Status | **NOT TESTED** |

### `PATCH /api/auth/change-password`
| Field | Value |
|-------|-------|
| Auth Required | Yes (JWT Bearer) |
| Role Required | None |
| Request Body | `{ currentPassword: string, newPassword: string }` |
| Response | `{ success: true, token: string, user: UserObject }` |
| Controller | `authController.js → changePassword()` |
| Database | MongoDB `findById().select("+password")` / `memoryUsers[]` |
| Validation | No minimum length check on newPassword |
| Error Handling | 401 wrong current password, 500 server error |
| Status | **IMPLEMENTED** (minor validation gap) |
| Test Status | **NOT TESTED** |

### `GET /api/health`
| Field | Value |
|-------|-------|
| Auth Required | No |
| Response | `{ success, service, version, status, db }` |
| Status | **IMPLEMENTED** |

---

## 3. Middleware Analysis

### `middleware/auth.js`
| Feature | Implementation |
|---------|---------------|
| Token extraction | `Authorization: Bearer <token>` header |
| Verification | `jwt.verify(token, process.env.JWT_SECRET)` |
| User lookup | MongoDB `findById()` or `memoryUsers.find()` |
| `isActive` check | Yes — deactivated users are rejected |
| Error responses | 401 no token, 401 invalid token, 401 session invalid |
| `restrictTo()` | Role-based guard factory — checks `req.user.role` |
| Status | **IMPLEMENTED** |

---

## 4. Model Analysis (`User.js`)

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| name | String | required, trim | No length validation |
| email | String | required, unique, lowercase, trim | No regex format validation |
| password | String | required, minlength:6, select:false | Hashed via pre-save hook |
| role | String | enum: [admin, member, viewer], default: member | Valid |
| avatar | String | default: "" | No URL validation |
| isActive | Boolean | default: true | Used for soft-delete |
| createdAt / updatedAt | Date | Auto-timestamps | Valid |

**Hooks:**
- `pre("save")`: Hashes password with bcrypt (rounds=12) if modified — **CORRECTLY IMPLEMENTED**
- `comparePassword()`: Instance method using bcrypt — **CORRECTLY IMPLEMENTED**
- `toJSON()`: Removes password from serialization — **CORRECTLY IMPLEMENTED**

---

## 5. Security Assessment

| Item | Status | Notes |
|------|--------|-------|
| Password hashing | ✅ IMPLEMENTED | bcrypt, rounds=12 |
| JWT signing | ✅ IMPLEMENTED | HS256, 7d expiry |
| JWT verification | ✅ IMPLEMENTED | middleware/auth.js |
| Protected routes | ✅ IMPLEMENTED | /me, /update-profile, /change-password |
| Password not in response | ✅ IMPLEMENTED | `select: false` + `toJSON()` |
| CORS configured | ✅ IMPLEMENTED | Restricted to FRONTEND_ORIGIN |
| Rate limiting | ❌ MISSING | No express-rate-limit or similar |
| Input sanitization | ❌ MISSING | No express-validator or joi |
| Email format validation | ❌ MISSING | Any string accepted as email |
| Password strength | ❌ MISSING | Only minlength:6 |
| CSRF protection | ❌ N/A | JWT-based auth doesn't require it |
| Helmet.js | ❌ MISSING | No HTTP security headers |
| Logging middleware | ❌ MISSING | No morgan or winston |
| Request ID | ❌ MISSING | No request tracing |

---

## 6. Critical Gaps

1. **No document/workspace/conversation routes** — The backend is auth-only. All AI functionality (uploads, chat, search, agents) goes directly to FastAPI with NO auth validation.

2. **JWT_SECRET from env but fallback not safe** — If `JWT_SECRET` is not set, `jwt.sign` and `jwt.verify` receive `undefined`, causing them to throw errors. No default is provided, which is actually correct (fails loudly) but is undocumented.

3. **In-memory fallback loses data on restart** — If MongoDB is unavailable, all registered users are lost when the server restarts. This is documented in the README as a known limitation but is not acceptable for production.

4. **Role validation gap** — `updateProfile` accepts any string for `role`. A user could set their role to `"superadmin"` or any arbitrary string. The Mongoose enum would reject this at the DB level, but in-memory mode has no such protection.

5. **No refresh token mechanism** — JWT expires after 7 days. There is no refresh token endpoint.
