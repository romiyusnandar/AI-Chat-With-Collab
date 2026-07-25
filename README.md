# AIChat Pro

A local character-AI chat app that connects to any OpenAI-compatible LLM
endpoint (e.g. Ollama + LiteLLM running on a free Google Colab GPU).

**Upgrades over the classic setup:**
- **SQLite storage** (`better-sqlite3`) — indexed, transactional, no file races.
- **SSE streaming** — replies appear word-by-word instead of after a long wait.
- **Optional token auth** — protect your chats when other devices share the WiFi.
- **Token-budget context window** — long chats are trimmed to fit the model.

---

## Architecture

```
Browser (public/) ──HTTP+SSE──> Node/Express (server.js) ──> SQLite (data/app.db)
                                        │
                                        └──OpenAI API──> LiteLLM ──> Ollama (Colab GPU)
                                                            via Cloudflare Tunnel
```

## Requirements
- [Node.js](https://nodejs.org/) 18+ on your machine.
- A Google account (for the free Colab GPU) — or any other OpenAI-compatible
  endpoint (OpenAI, OpenRouter, a local Ollama, etc.).

---

## 1. Start the LLM server (Google Colab)
1. Open <https://colab.research.google.com/> → new notebook.
2. **Runtime → Change runtime type → T4 GPU**.
3. Paste the contents of `colab_server.py` into a cell and run it.
4. Wait for it to finish (~10-15 min the first time). It prints:
   ```
   BASE_URL=https://xxxx.trycloudflare.com
   LLM_API_KEY=sk-colab-local
   MODEL_NAME=character1
   ```
5. **Leave that cell running.** The URL changes every time Colab restarts.

## 2. Start the local app
```bash
npm install          # installs deps (compiles better-sqlite3)
cp .env.example .env # then edit .env with the values from Colab
npm run seed         # optional: add two example characters
npm start
```
Open <http://localhost:3000>. Click **Test LLM connection** to confirm it reaches Colab.

## 3. Use it
- Pick a character → **+** next to *Chats* to start a chat → type and send.
- Create your own character with the **+** next to *Characters*.
- From another device on the same WiFi: `http://<your-computer-IP>:3000`.

---

## Configuration (`.env`)
| Key | Meaning |
|-----|---------|
| `BASE_URL` | The Colab/LiteLLM URL (OpenAI-compatible base). |
| `LLM_API_KEY` | Key the proxy expects (`sk-colab-local` by default). |
| `MODEL_NAME` | Model name the proxy exposes (`character1`). |
| `APP_TOKEN` | Set a secret to require login; leave empty to disable auth. |
| `PORT` | Web server port (default 3000). |
| `TEMPERATURE` / `TOP_P` / `MAX_TOKENS` | Generation tuning. |

## Notes
- Free Colab has session limits and the tunnel URL is temporary — expect to
  update `BASE_URL` whenever you restart Colab.
- To use a non-Colab endpoint, just point `BASE_URL`/`LLM_API_KEY`/`MODEL_NAME`
  at it. No code changes needed (that's the benefit of the OpenAI-compatible layer).

## Next steps (not in this v1)
- Persistent memory + auto-summarize long chats.
- Edit/regenerate individual messages.
- Character avatars and import/export.
