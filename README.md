# Real-Time Forum SPA 🚀

A fast, single-page application (SPA) forum built with **Go**, **SQLite**, and **Vanilla JavaScript**. 

This forum allows users to create posts, comment, and chat privately in real-time!

---

## 🌟 Key Features

* **Real-Time Private Chat:** Instant messaging with other users. See who is online!
* **Posts & Comments:** Create posts, categorize them, and discuss in comments.
* **Fast Navigation:** As a Single Page Application, moving between pages is instant with no reloading.
* **Secure Authentication:** Sign in securely using your Nickname or Email.
* **Smart Sorting:** Active chats stay at the top, just like your favorite messaging apps.

---

## 🛠️ Tech Stack

* **Backend:** Go (Golang)
* **Database:** SQLite
* **Real-Time Engine:** WebSockets (Gorilla WebSocket)
* **Frontend:** HTML, CSS, and Vanilla JavaScript (No heavy frameworks here!)

---

## 🚀 Getting Started

Follow these simple steps to run the forum on your local machine.

### Prerequisites
Make sure you have installed on your system:
* **Go** (version 1.21 or higher)
* **C compiler (GCC/Clang)** (required for setting up the SQLite database)
* **Node.js** (only to run the frontend tests)

### Installation & Running

1. **Clone the repository:**
   ```bash
   git clone https://01.tomorrow-school.ai/git/azhakysh/real-time-forum.git
   cd real-time-forum
   ```

2. **Install dependencies:**
   ```bash
   go mod tidy
   ```

3. **Start the server:**
   ```bash
   go run cmd/server/main.go
   ```

4. **Access the Application:**
   Open your web browser and go to: [http://localhost:8080](http://localhost:8080)

---

## 🧪 Tests

```bash
go test ./...                      # backend: models, handlers, chat hub, routing
node tests/frontend/app.test.mjs   # frontend: rendering, routing, session handling
```

The frontend tests run the real ES modules against a small DOM stub, so no
browser or build step is needed.

## 🏗️ Project Structure

```
cmd/server/main.go          entry point: routes, timeouts, graceful shutdown
internal/
  chat/                     websocket hub and per-connection pumps
  database/                 SQLite schema and connection settings
  handlers/                 HTTP handlers, auth middleware, SPA file serving
  models/                   data access layer
frontend/
  index.html                the single page of the application
  static/css/style.css      styling, including the typing animation
  static/js/
    app.js                  bootstrap: routes, socket dispatch, session flow
    router.js               History API routing
    state.js  api.js  ws.js  utils.js
    views/                  auth, feed, post, chat and reaction views
tests/frontend/             frontend test suite and its DOM stub
```

## 🧭 Routing

The application is a single page, but every view has its own URL, so a reload
or a shared link lands where you expect:

| URL | View |
|---|---|
| `/` | post feed |
| `/posts/{id}` | one post with its comments |
| `/?chat={userId}` | the feed with a conversation open |
| `/login`, `/register` | authentication |

---

## 📜 License
This project is open-source and available under the MIT License.
