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

## 🏗️ Project Structure

Here is a quick overview of how the code is organized:

* `cmd/server/main.go` - The entry point that starts the server.
* `internal/` - Core backend logic (database, web handlers, and real-time chat server).
* `frontend/` - Contains our frontend UI inside `index.html` and static files (JavaScript, CSS).

---

## 📜 License
This project is open-source and available under the MIT License.
