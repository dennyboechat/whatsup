# WhatsUp

Local-first Node.js app that connects to **WhatsApp Web**, records messages from **one** named group into **SQLite**, and builds structured summaries with the **OpenAI API**. Run it on your machine or in **Docker** on a server.

**In short:** listen → **`summarize`** (time-windowed batch + OpenAI) → **`report`** / **`post`** → optional **`cron start`** for a daily 23:00 (Brasília) summarize-and-post.

---

## Prerequisites

- **Node.js 20+** (for local runs), or **Docker** + Compose (for servers)
- A WhatsApp account you can link with a **QR code** (first run)
- An **OpenAI API key** (only the summarization call goes to OpenAI; WhatsApp traffic stays local)

---

## Local setup

### 1. Install

```bash
cd /path/to/WhatsUp
npm install
```

### 2. Environment

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | **Required** for summarization |
| `TARGET_GROUP_NAME` | Default group title (case-insensitive). Override in the REPL with **`group <title>`**, or use **`once`** / **`summarize <title>`** for a single run |
| `SUMMARY_WINDOW_HOURS` | Prefer text messages from the last *N* hours (default `24`) |
| `SUMMARY_FALLBACK_MESSAGES` | If nothing in that window, use the *M* most recent text messages (default `50`) |
| `SUMMARY_MAX_FETCH_MESSAGES` | Max messages to load from WhatsApp while filling the window (default `2000`; increase for very active chats) |
| `OPENAI_MODEL` | Model with JSON mode (default `gpt-4o-mini`) |
| `OPENAI_MAX_RETRIES` | Retries for OpenAI failures (default `3`) |
| `OPENAI_RETRY_BASE_MS` | Base backoff in ms (default `1000`) |
| `OPENAI_MIN_REQUEST_INTERVAL_MS` | Minimum gap between OpenAI calls (default `500`) |
| `PUPPETEER_EXECUTABLE_PATH` | *(Optional)* Chrome/Chromium/Edge if auto-detection fails (macOS/Linux/Windows paths) |

### 3. Run

```bash
npm run start
```

- Scan the **QR code** in the terminal (**WhatsApp → Linked devices**).
- Session files live under **`data/wwebjs_session/`** (usually one scan).
- When ready, use the **`WhatsUp>`** prompt for commands below.

Stop with **`Ctrl+C`** or **`exit`**.

---

## Docker (server)

Requires [Docker Compose](https://docs.docker.com/compose/) v2 (`docker compose`).

1. Copy **`.env.example`** to **`.env`** and set at least **`OPENAI_API_KEY`** and **`TARGET_GROUP_NAME`**.
2. Build and run (foreground is easiest for the **QR** and **`WhatsUp>`**):

   ```bash
   docker compose build
   docker compose up
   ```

3. **Data**: **`./data`** on the host is mounted to **`/app/data`** (SQLite + WhatsApp session). Back it up when moving servers.
4. The image includes **Chromium**; Compose sets **`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`**.
5. **Background**: `docker compose up -d` hides the REPL until **`docker attach whatsup`**. Detach without stopping: **Ctrl+P**, then **Ctrl+Q**. For the **first QR scan**, use a real TTY (e.g. **`tmux`** or SSH with a terminal).

---

## Interactive commands (`WhatsUp>`)

| Command | Purpose |
|---------|---------|
| `help` | List commands |
| `group` | Show or set the **session** default group (`group <title>`, `group reset`). Listener + summarize use this unless you pass another name. |
| `summarize` | Summarize the **effective** group (`.env` + optional session override). |
| **`once <name>`** | One-off summary for **that** group only; does **not** change `group`. Title must match WhatsApp (`groups`); case-insensitive. Same as **`summarize <name>`**. |
| `report` | Print the **latest** saved summary (Summary, Topics, Decisions, …; includes **`Group:`** when the row stores it). |
| `status` | Daily cron on/off, effective group, DB counts, session override |
| `groups` | List WhatsApp group names (this session) |
| **`post`** | Send the latest summary to the **group that summary was built from**. **`post <title>`** sends to another group. Long text is split into multiple messages. |
| **`cron start`** | Daily at **23:00** **`America/Sao_Paulo`** (Brasília): **`summarize`** then **`post`** for the **effective** group. Cleared on **`cron stop`**, **`exit`**, or **Ctrl+C**. |
| `cron stop` / `cron status` | Stop or show the daily job |
| `exit` | Quit |

---

## CLI scripts (optional)

| Script | Notes |
|--------|--------|
| `npm run summarize` | Like interactive summarize; **opens its own** browser session — **stop `npm run start`** first, or use the REPL. Optional: `npm run summarize -- "Group Name"`. |
| `npm run report` | Latest summary to stdout (no WhatsApp) |
| `npm run export` | Writes **`data/exports/summary-<timestamp>.md`** |
| `npm run groups` / `npm run status` | Standalone session for lists / status — stop **`npm run start`** first if you use a separate session |

---

## How it works

- **WhatsApp** (`whatsapp-web.js` + `LocalAuth`): only the **effective** group is stored; empty and **media-only** messages are skipped.
- **SQLite**: **`data/whatsup.db`** holds messages (deduped by optional `wa_message_id`) and summaries. Each summary stores **`group_name`** so **`post`** can target the group that run summarized.
- **Summarize**: Loads text from WhatsApp, prefers the last **`SUMMARY_WINDOW_HOURS`**; if empty, uses the last **`SUMMARY_FALLBACK_MESSAGES`**. OpenAI returns JSON (`topics`, `decisions`, `action_items`, `questions`, `summary`). Retries + rate limiting apply.
- **Cron**: **`cron start`** uses **`node-cron`** once per day at **23:00 Brasília** for summarize + post, using the **current** effective group.

---

## Data layout

| Path | Contents |
|------|----------|
| `data/whatsup.db` | Messages + summaries |
| `data/wwebjs_session/` | WhatsApp session (private; in `.gitignore`) |
| `data/exports/` | Markdown from **`npm run export`** |

---

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| No messages from **`summarize`** | Match **`TARGET_GROUP_NAME`** to the real title (**`groups`**). Need **text** messages (media-only ignored). |
| Wrong group / nothing stored | Same as above; titles are case-insensitive. |
| OpenAI errors | **`OPENAI_API_KEY`**, **`OPENAI_MODEL`** with JSON mode. |
| Chrome / Puppeteer (local) | Install Chrome or set **`PUPPETEER_EXECUTABLE_PATH`**, or `npx puppeteer browsers install chrome`. |
| Docker | Ensure **`./data`** is writable; use **`-it`** / **`tty: true`** when you need QR or REPL. |

---

## Security

Treat **`.env`**, **`data/whatsup.db`**, and **`data/wwebjs_session/`** like credentials.

**`post`** sends text **as your WhatsApp user** into the chosen group (default: the summarized group)—only use when appropriate.
