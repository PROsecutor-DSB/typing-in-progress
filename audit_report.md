# 🔴 Senior Audit Report — "Real-Time Forum: Typing in Progress"

> Auditor mindset: *"I'm here to break it, not to admire it."*

---

## 1. Audit Checklist — Will It Pass?

| # | Audit Question | Verdict | Notes |
|---|---|---|---|
| 1 | Allowed packages respected? | ✅ PASS | `gorilla/websocket`, `go-sqlite3`, `bcrypt`, `gofrs/uuid` — all allowed. `golang.org/x/crypto` is standard-adjacent and universally accepted. |
| 2 | Animation confirming typing in progress? | ✅ PASS | Dots animation exists in CSS with `@keyframes typing-bounce`. |
| 3 | Animation smooth, without interruptions? | ✅ PASS | CSS-only animation with `ease-in-out`, no JS jank dependency. |
| 4 | Animation user friendly? | ✅ PASS | `"<name> is typing..."` with bouncing dots — standard UX pattern. |
| 5 | Name of user typing visible? | ✅ PASS | `msg.nickname` is sent from server and displayed in `.typing-name`. |
| 6 | Stops when user stops typing? | ✅ PASS | 1.5s debounce sends `typing: false`, blur event also stops it. 3s safety timeout on receiver side. |
| 7 | Works for both users bidirectionally? | 🔴 **FAIL** | See **Critical Bug #1** below — Hub never processes `Unregister`. On disconnect the goroutine deadlocks. After the first disconnect+reconnect the system breaks. |  
| **Bonus** | Runs quickly and effectively? | ⚠️ PARTIAL | See issues below. |
| **Bonus** | Good practices? | 🔴 NO | See full list below. |
| **Bonus** | Synchronicity (Promises / goroutines)? | ⚠️ PARTIAL | Go channels exist but are broken. JS uses async/await. |
| **Bonus** | Well done in general? | ⚠️ PARTIAL | Core idea is solid but critical bugs will cause failures during live demo. |

---

## 2. 🔴 Critical Bugs (Will fail the demo)

### Critical Bug #1: Hub `Unregister` channel is DEAD

**File:** [hub.go](file:///c:/Users/Daniyar/OneDrive/Desktop/real-time-forum-typing-in-progress/internal/chat/hub.go#L29-L126)

The `Run()` select loop handles `Register` and `Broadcast` but **never reads from `Unregister`**.

```go
// hub.go — Run() only has:
case client := <-h.Register:    // ✅ handled
case message := <-h.Broadcast:  // ✅ handled
// case client := <-h.Unregister: // ❌ MISSING!
```

Meanwhile `client.go` line 47 does:
```go
c.Hub.Unregister <- c  // blocks forever — nobody reads this channel
```

**Consequences:**
- `ReadPump()` goroutine **blocks forever** on disconnect → goroutine leak
- Disconnected clients **stay in `h.Clients` map** → ghost connections
- User status is **never broadcast as `offline`** → everyone appears online forever
- After enough disconnects, the unbuffered `Unregister` channel fills up and the system deadlocks
- **The auditor will close a tab, reopen it, and the typing indicator will break**

### Critical Bug #2: WritePump batching corrupts JSON messages

**File:** [client.go](file:///c:/Users/Daniyar/OneDrive/Desktop/real-time-forum-typing-in-progress/internal/chat/client.go#L156-L162)

```go
w.Write(message)
n := len(c.Send)
for i := 0; i < n; i++ {
    w.Write(<-c.Send)  // ← concatenates raw JSON WITHOUT delimiter
}
```

If two messages arrive near-simultaneously, the receiver gets `{"type":"typing"...}{"type":"message"...}` — a single WebSocket frame containing **invalid JSON**. `JSON.parse()` on the frontend will throw, silently dropping both messages.

### Critical Bug #3: Session expiry not checked on WebSocket connect

**File:** [ws.go](file:///c:/Users/Daniyar/OneDrive/Desktop/real-time-forum-typing-in-progress/internal/handlers/ws.go#L19-L23)

```go
session, err := h.Sessions.GetByToken(c.Value)
if err != nil { ... }
// ❌ Never checks: session.ExpiresAt.Before(time.Now())
```

Posts handler checks expiry (line 24 of `posts.go`), but WebSocket does not. An expired session can still open a WebSocket.

---

## 3. 🟡 Significant Bugs (Will annoy the auditor)

### Bug #4: `GetUsersHandler` returns ALL users including yourself with no distinction

**File:** [ws.go](file:///c:/Users/Daniyar/OneDrive/Desktop/real-time-forum-typing-in-progress/internal/handlers/ws.go#L93-L124)

The endpoint is unauthenticated — no session check. Anyone can enumerate all users. While the frontend now marks "You", the API leaks data.

### Bug #5: `maxMessageSize = 512` is very small

**File:** [client.go](file:///c:/Users/Daniyar/OneDrive/Desktop/real-time-forum-typing-in-progress/internal/chat/client.go#L17)

512 bytes for a chat message is tiny. A message with a long text + JSON envelope + UTF-8 emoji will easily exceed this. The WebSocket read will fail silently and disconnect the client. The auditor types a paragraph → connection drops.

### Bug #6: XSS vulnerability via `msg.content`, `post.title`, `post.content`

**File:** [app.js](file:///c:/Users/Daniyar/OneDrive/Desktop/real-time-forum-typing-in-progress/frontend/static/js/app.js#L314-L315)

```javascript
${msg.content}           // ← raw HTML injection
${post.title}            // ← raw HTML injection
${post.content}          // ← raw HTML injection
${c.content}             // ← raw HTML injection (comments)
```

Any user can send `<img src=x onerror=alert(1)>` as a message. CSP mitigates `script-src` but not all vectors.

### Bug #7: Nickname with apostrophe breaks user list

**File:** [app.js](file:///c:/Users/Daniyar/OneDrive/Desktop/real-time-forum-typing-in-progress/frontend/static/js/app.js#L434)

```javascript
onclick="renderChat(${u.id}, '${u.nickname}')"
```

If nickname is `O'Brien`, the HTML becomes `renderChat(5, 'O'Brien')` → JavaScript syntax error, entire user list click handlers break.

### Bug #8: Login doesn't invalidate old sessions

**File:** [auth.go](file:///c:/Users/Daniyar/OneDrive/Desktop/real-time-forum-typing-in-progress/internal/handlers/auth.go#L59-L108)

Each login creates a new session without deleting old ones. Multiple sessions accumulate in the DB. The `sessions` table grows unbounded. This also means one user can have multiple active sessions which could lead to ghost WebSocket connections.

---

## 4. 🟠 Code Quality Issues (Bonus points killer)

### Issue #9: `isValidCategory()` rebuilds map on every call

```go
func isValidCategory(category string) bool {
    valid := map[string]bool{...}  // heap allocation every call
    return valid[category]
}
```

Should be a package-level `var` or use a switch.

### Issue #10: Reaction handler has no Content-Type header

**File:** [reaction.go](file:///c:/Users/Daniyar/OneDrive/Desktop/real-time-forum-typing-in-progress/internal/handlers/reaction.go#L99)

```go
json.NewEncoder(w).Encode(...)  // no w.Header().Set("Content-Type", "application/json")
```

Same issue in `GetChatHistoryHandler` and `GetUsersHandler`.

### Issue #11: Dead code

- `formatMessageContent` (line 323) — wraps `formatMessage`, never called
- `window.renderChat = renderChat` duplicated (lines 678-679)
- `window.setCategory = setCategory` registered twice (lines 507 and 681)

### Issue #12: Mutex usage inconsistency in Hub

In `broadcastUserStatus()`, mutex is Lock/Unlock'd cleanly, but then `broadcastUserStatus` is called **after** an `h.Mu.Unlock()` inside the `Register` case, which immediately tries to `Lock` again inside `broadcastUserStatus`. This is fragile but not buggy since the lock was released. However, the inline status-pushing block (lines 43-67) holds the lock while doing channel sends — if any client's `Send` channel is full, this deadlocks under the mutex.

### Issue #13: No WebSocket reconnection logic

When the WebSocket drops (network blip, server restart), the frontend never reconnects. The user must refresh the page. All typing indicators stop working silently.

### Issue #14: `golang.org/x/crypto` is NOT a "standard go package"

The task says "All standard go packages are allowed" plus specific third-party packages (`gorilla/websocket`, `sqlite3`, `bcrypt`, `gofrs/uuid`). `bcrypt` here refers to `golang.org/x/crypto/bcrypt`. This is arguably fine since the task lists it, but a strict auditor could note that `golang.org/x/crypto` is listed as a separate import in `go.mod` — it should be explicitly justified as the implementation of the allowed "bcrypt".

---

## 5. Architecture Summary

```
cmd/server/main.go          ← entrypoint, routes
internal/
  chat/
    hub.go                   ← WebSocket hub (goroutine + channels)
    client.go                ← per-connection read/write pumps
  handlers/
    auth.go                  ← register, login, logout, /api/me
    posts.go, comments.go    ← CRUD
    reaction.go              ← like/dislike with WS broadcast
    ws.go                    ← WS upgrade, chat history, users list
  models/                    ← DB access layer
  database/
    sqlite.go                ← schema init
frontend/
  index.html                 ← SPA shell
  static/js/app.js           ← all frontend logic (~760 lines)
  static/css/style.css       ← styling + typing animation
```

---

## 6. Priority Fix Order

| Priority | Fix | Effort |
|----------|-----|--------|
| **P0** | Add `Unregister` case to Hub.Run() | 10 min |
| **P0** | Fix WritePump JSON batching (add newline delimiter or send individually) | 5 min |
| **P1** | Check session expiry in ServeWs | 2 min |
| **P1** | Increase maxMessageSize to 4096+ | 1 min |
| **P1** | Escape HTML in user-generated content | 10 min |
| **P2** | Escape quotes in nicknames for onclick handlers | 5 min |
| **P2** | Add Content-Type headers to JSON responses | 5 min |
| **P2** | Clean up dead code | 3 min |
| **P3** | Add WS reconnection logic | 15 min |
| **P3** | Invalidate old sessions on login | 5 min |

---

> **Bottom line:** The typing indicator *concept* is correctly implemented and will impress for 30 seconds. But Critical Bug #1 (missing Unregister) means the demo **will break** the moment the auditor closes a tab or refreshes. Fix P0 items before the audit.
