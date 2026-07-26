# AIChat Pro

Aplikasi chat karakter AI yang berjalan lokal di komputer kamu, tapi
"otaknya" (LLM) bisa datang dari mana saja yang kompatibel dengan API
OpenAI — termasuk GPU gratis di Google Colab (Ollama + LiteLLM + Cloudflare
Tunnel).

**Fitur utama:**
- **Alur 3 layar** — pilih karakter → lihat histori chat karakter itu →
  masuk ke percakapan. Bisa ganti karakter kapan saja tanpa kehilangan
  histori.
- **Multi-karakter & multi-chat** — tiap karakter bisa punya banyak
  percakapan terpisah, masing-masing bisa dihapus kapan saja.
- **Memori jangka panjang** — setiap 20 pesan, chat otomatis diringkas
  dan fakta pentingnya disimpan sebagai "memori" karakter, lalu disuntikkan
  kembali ke prompt di percakapan berikutnya. Bisa juga diringkas manual
  atau diedit langsung dari UI.
- **Penyimpanan SQLite** (`better-sqlite3`) — terindeks, transaksional,
  tanpa race condition file.
- **Streaming SSE** — balasan AI muncul kata demi kata, bukan menunggu
  lama baru muncul sekaligus.
- **Avatar otomatis** — karakter hasil `npm run seed` dapat avatar
  gradient warna yang digenerate otomatis dari nama (tidak perlu pilih
  kode warna manual); avatar kustom (upload gambar) juga didukung.
- **Auth token opsional** — lindungi chat kamu saat perangkat lain berbagi
  WiFi yang sama.
- **Context window berbasis token budget** — chat panjang otomatis
  dipangkas supaya tetap muat di model.
- **Responsif** — nyaman dipakai di desktop maupun HP.

---

## Arsitektur

```
Browser (public/) ──HTTP+SSE──> Node/Express (server.js) ──> SQLite (data/app.db)
                                        │
                                        └──OpenAI API──> LiteLLM ──> Ollama (GPU Colab)
                                                            via Cloudflare Tunnel
```

- `server.js` — REST API + endpoint SSE untuk streaming balasan + serve
  frontend statis.
- `db.js` — lapisan data SQLite (tabel `characters`, `chats`, `messages`,
  `memory`).
- `llm.js` — klien ke endpoint LLM (OpenAI-compatible): membangun system
  prompt karakter, memangkas histori sesuai token budget, streaming token,
  dan meringkas percakapan jadi memori.
- `public/` — frontend statis (vanilla JS, tanpa build step): `index.html`,
  `app.js`, `styles.css`.
- `seed.js` — skrip opsional untuk mengisi beberapa karakter contoh.
- `colab_server.ipynb` — notebook yang dijalankan di Google Colab untuk
  menyalakan Ollama + LiteLLM + Cloudflare Tunnel.

## Kebutuhan
- [Node.js](https://nodejs.org/) 18+ di komputer kamu.
- Akun Google (untuk GPU gratis Colab) — atau endpoint OpenAI-compatible
  lain apa saja (OpenAI, OpenRouter, Ollama lokal, dll).

---

## 1. Nyalakan server LLM (Google Colab)
1. Buka <https://colab.research.google.com/> → buat notebook baru.
2. **Runtime → Ubah tipe runtime → GPU T4**.
3. Tempel isi `colab_server.ipynb` ke sebuah sel, lalu jalankan.
4. Tunggu sampai selesai (~10–15 menit di percobaan pertama). Notebook akan
   mencetak:
   ```
   BASE_URL=https://xxxx.trycloudflare.com
   LLM_API_KEY=sk-colab-local
   MODEL_NAME=character1
   ```
5. **Biarkan sel itu tetap berjalan.** URL-nya berubah setiap kali Colab
   di-restart.

## 2. Jalankan aplikasi lokal
```bash
npm install          # instal dependency (mengompilasi better-sqlite3)
cp .env.example .env # lalu isi dengan nilai dari Colab
npm run seed         # opsional: tambah beberapa karakter contoh
npm start
```
Buka <http://localhost:3000>. Klik **Tes koneksi** di layar Karakter untuk
memastikan aplikasi bisa menjangkau Colab.

## 3. Cara pakai
- **Belum punya karakter?** Layar pertama akan menampilkan ajakan untuk
  membuat karakter dulu — klik **+ Buat karakter** / **+ Baru**.
- Klik sebuah karakter → masuk ke daftar chat karakter tersebut → klik
  **+ Chat baru** untuk mulai percakapan, atau pilih chat lama untuk
  melanjutkan.
- Tombol **←** di kiri atas dipakai untuk kembali (ganti karakter / kembali
  ke daftar chat).
- Hapus chat lewat ikon 🗑 di daftar chat atau di header percakapan; hapus
  karakter lewat ikon 🗑 di kartu karakter (akan menghapus juga semua chat
  dan memorinya).
- Ikon 🧠 di header percakapan menampilkan memori karakter (fakta &
  ringkasan), ikon 🧾 meringkas chat yang sedang dibuka secara manual.
- Dari perangkat lain di WiFi yang sama: `http://<IP-LAN-komputermu>:3000`
  — IP ini otomatis dicetak di terminal saat `npm start` dijalankan.

---

## Konfigurasi (`.env`)
| Key | Arti |
|-----|------|
| `BASE_URL` | URL Colab/LiteLLM (base OpenAI-compatible). |
| `LLM_API_KEY` | Key yang diharapkan proxy (`sk-colab-local` secara default). |
| `MODEL_NAME` | Nama model yang diekspos proxy (`character1`). |
| `APP_TOKEN` | Isi dengan rahasia untuk mewajibkan login; kosongkan untuk menonaktifkan auth. |
| `PORT` | Port web server (default 3000). |
| `TEMPERATURE` / `TOP_P` / `TOP_K` / `MAX_TOKENS` | Tuning generasi teks. |
| `REPLY_LANGUAGE` | Bahasa balasan karakter (default `Indonesian`). Isi `auto`/`match` supaya karakter mengikuti bahasa yang dipakai pengguna. |

## Catatan
- Colab gratis punya batas sesi dan URL tunnel-nya sementara — siap-siap
  update `BASE_URL` setiap kali Colab di-restart.
- Untuk pakai endpoint selain Colab, cukup arahkan
  `BASE_URL`/`LLM_API_KEY`/`MODEL_NAME` ke sana. Tidak perlu ubah kode
  (itulah untungnya lapisan OpenAI-compatible).
- Data tersimpan lokal di `data/app.db` (SQLite, mode WAL). Hapus file ini
  untuk reset total.
