# WhatsApp AI Agent — Complete Project Plan

> Yeh document aapke project ka poora plan hai. Decisions, architecture, phases, aur steps sab kuch yahan likha hai.

---

## 1. Tech Stack (Final Decisions)

| Component | Technology |
|-----------|-----------|
| **Runtime** | Node.js (v18+) |
| **Framework** | Express.js |
| **WhatsApp** | whatsapp-web.js + Puppeteer |
| **Database** | MongoDB + Mongoose |
| **AI Providers** | Google Gemini (pehle), baad mein Claude / NVIDIA NIM |
| **Vector Store** | ChromaDB (RAG ke liye) |
| **Document Conversion** | Python MarkItDown (subprocess) |
| **Real-time** | Socket.io |
| **Frontend** | Simple HTML page (React optional baad mein) |
| **File Upload** | Multer |

---

## 2. Database Schema (MongoDB)

### Collections

#### `settings`
```json
{
  "agentName": "WhatsAgent AI",
  "agentPersona": "You are a customer support agent...",
  "geminiApiKey": "AIzaSy...",
  "claudeApiKey": "sk-ant-...",
  "nvidiaApiKey": "nvapi-...",
  "aiProvider": "gemini",
  "responseDelay": 1500,
  "autoReplyEnabled": true,
  "temperature": 0.7,
  "ragEnabled": true
}
```

#### `faqs`
```json
{
  "question": "What are your hours?",
  "answer": "We are open Monday to Friday, 9am to 5pm.",
  "createdAt": "2026-06-06T12:00:00Z"
}
```

#### `chats`
```json
{
  "chatId": "phone-number@c.us",
  "senderName": "User",
  "messages": [
    {
      "from": "user/agent",
      "text": "Hello",
      "timestamp": "2026-06-06T12:00:00Z"
    }
  ]
}
```

#### `analytics`
```json
{
  "totalMessages": 0,
  "aiResponses": 0,
  "humanEscalations": 0,
  "avgResponseTimeMs": 1200
}
```

#### `documents`
```json
{
  "filename": "policy.pdf",
  "originalType": "pdf",
  "chunkCount": 12,
  "status": "ready",
  "uploadedAt": "2026-06-06T12:00:00Z"
}
```

---

## 3. Project Structure

```
whatsapp-agent/
├── backend/
│   ├── package.json
│   ├── .env                    # MongoDB URI, API keys
│   ├── .wwebjs_auth/           # WhatsApp session
│   ├── chromadb/               # ChromaDB persistent data
│   ├── uploads/                # Temporary uploaded files
│   └── src/
│       ├── server.js           # Express + Socket.io bootloader
│       ├── db.js               # MongoDB connection
│       ├── models/
│       │   ├── Settings.js
│       │   ├── Faq.js
│       │   ├── Chat.js
│       │   ├── Analytics.js
│       │   └── Document.js
│       ├── whatsapp.js         # WhatsApp client + watchdog
│       ├── agent.js            # AI router + RAG context
│       ├── driverManager.js    # Lock/process cleaner
│       ├── documentManager.js  # Upload → MarkItDown → chunk → store
│       ├── chromaClient.js     # ChromaDB abstraction
│       ├── routes/
│       │   ├── settings.js
│       │   ├── faqs.js
│       │   ├── whatsapp.js
│       │   ├── documents.js
│       │   └── simulator.js
│       └── providers/
│           ├── index.js        # Provider coordinator
│           ├── gemini.js       # Gemini SDK
│           ├── claude.js       # Claude REST API
│           ├── nvidia.js       # NVIDIA NIM REST API
│           └── embedder.js     # Embedding abstraction
├── frontend/
│   └── index.html              # Simple HTML page (QR + status + logs)
└── README.md
```

---

## 4. Phases & Steps

### Phase 1: Foundation

| # | Step | Files |
|---|------|-------|
| 1.1 | Initialize `package.json` (express, socket.io, mongoose, puppeteer, whatsapp-web.js, multer, chromadb, @google/generative-ai, dotenv, uuid) | `package.json` |
| 1.2 | MongoDB connection setup | `src/db.js`, `.env` |
| 1.3 | Create all Mongoose models | `src/models/*.js` |
| 1.4 | Express server with Socket.io, CORS, JSON parser, routes binding | `src/server.js` |
| 1.5 | Environment variables (MongoDB URI, ports) | `.env` |

### Phase 2: WhatsApp Engine

| # | Step | Files |
|---|------|-------|
| 2.1 | Stale lock cleaner (SingletonLock, lockfile removal) | `src/driverManager.js` |
| 2.2 | WhatsApp client with Puppeteer, QR event → base64 → Socket.io | `src/whatsapp.js` |
| 2.3 | State machine: DISCONNECTED → STARTING → CONNECTING → SCAN_QR → CONNECTED | `src/whatsapp.js` |
| 2.4 | Watchdog timer (30s health check, auto-reconnect on failure) | `src/whatsapp.js` |
| 2.5 | WhatsApp REST routes (disconnect, remove session) | `src/routes/whatsapp.js` |

### Phase 3: AI Registry & Agent

| # | Step | Files |
|---|------|-------|
| 3.1 | Gemini provider (Google Generative AI SDK) | `src/providers/gemini.js` |
| 3.2 | Claude provider (Anthropic REST API) | `src/providers/claude.js` |
| 3.3 | NVIDIA NIM provider | `src/providers/nvidia.js` |
| 3.4 | Provider router — settings ke hisaab se dispatch, 3 retries with exponential backoff | `src/providers/index.js` |
| 3.5 | Agent — prompt builder (persona + FAQ + RAG context + incoming message), provider call, error handling, FAQ fallback | `src/agent.js` |
| 3.6 | Settings REST routes | `src/routes/settings.js` |
| 3.7 | FAQ REST routes | `src/routes/faqs.js` |

### Phase 4: Frontend

| # | Step | Files |
|---|------|-------|
| 4.1 | Simple HTML page with QR display, status indicator, log stream, connect/disconnect buttons | `frontend/index.html` |
| 4.2 | Socket.io client in browser — listen for `qr` (base64), `status-update`, `new-message`, `analytics-update` | `frontend/index.html` |
| 4.3 | CSS styling — dark theme, clean layout | `frontend/index.html` (inline ya separate CSS) |

### Phase 5: RAG & Documents

| # | Step | Files |
|---|------|-------|
| 5.1 | Python MarkItDown install | `pip install markitdown` |
| 5.2 | ChromaDB client — connect, collection create, insert/search/delete | `src/chromaClient.js` |
| 5.3 | Embedder abstraction (placeholder — Gemini API ya ChromaDB built-in) | `src/providers/embedder.js` |
| 5.4 | Document manager — upload → MarkItDown subprocess → chunk (overlapping) → embed → ChromaDB store → metadata in MongoDB | `src/documentManager.js` |
| 5.5 | Document REST routes (upload, list, get, delete) + multer middleware | `src/routes/documents.js` |
| 5.6 | Modify agent.js — incoming message → embed → ChromaDB top-5 chunks → prompt injection | `src/agent.js` |
| 5.7 | Frontend — upload button, file list, status indicators | `frontend/index.html` |

---

## 5. APIs

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/settings` | Settings fetch |
| POST | `/api/settings` | Settings save |
| GET | `/api/faqs` | FAQs fetch |
| POST | `/api/faqs` | FAQs save |
| POST | `/api/whatsapp/disconnect` | WhatsApp disconnect |
| POST | `/api/whatsapp/remove` | Session remove |
| POST | `/api/simulator/message` | Mock message test |
| POST | `/api/documents/upload` | Document upload |
| GET | `/api/documents` | Document list |
| DELETE | `/api/documents/:id` | Document delete |
| GET | `/api/documents/:id` | Document detail |

---

## 6. WhatsApp Connection Flow

```
DISCONNECTED
    │
    ▼
STARTING ──► Clean locks, kill orphan Chrome
    │
    ▼
CONNECTING ──► Launch Puppeteer
    │
    ▼
SCAN_QR ──► QR code emit to frontend (WebSocket)
    │
    ▼
CONNECTED ──► Messages listen, auto-reply active
    │
    ▼
RECONNECTING ──► Watchdog triggers on disconnect (30s check)
```

---

## 7. AI Prompt Flow

```
Incoming WhatsApp Message
    │
    ▼
Fetch Settings from MongoDB (persona, provider, keys)
    │
    ▼
Fetch matching FAQs
    │
    ▼
(If RAG enabled) Embed query → ChromaDB search → top 5 chunks
    │
    ▼
Build Prompt:
    System: [Persona]
    FAQ Context: [Matching FAQs]
    Document Context: [ChromaDB chunks]
    Message: [Sender]: "[Text]"
    │
    ▼
Send to AI Provider (Gemini/Claude/NVIDIA)
    │
    ▼
Send reply via WhatsApp
    │
    ▼
Log to MongoDB (Chat, Analytics)
```

---

## 8. Installation & Run Commands

```bash
# Backend
cd backend
npm install
npm run dev        # nodemon server.js

# Environment (.env)
MONGODB_URI=mongodb://localhost:27017/whatsagent
PORT=5000

# Python (RAG ke liye)
pip install markitdown
```

---

## 9. Order of Development

```
Week 1: Phase 1 (Foundation) + Phase 2 (WhatsApp Engine)
Week 2: Phase 3 (AI Agent) + Phase 4 (Frontend)
Week 3: Phase 5 (RAG & Documents)
Week 4: Testing, debugging, production ready
```

---

> **Next Step:** Jab aap kaho, Phase 1.1 se start karte hain — `package.json` create karein aur dependencies install karein.
