# cloudflare-free — render HyperFrames 100% di paket gratis

Layanan render video tanpa server berbayar: **Cloudflare Workers Free** (API) +
**R2 free tier** (penyimpanan) + **GitHub Actions** (mesin render, FFmpeg + Chrome).
Tidak memakai Workers Paid, Containers, Sandbox, maupun Browser Rendering.
Kode inti di `packages/` tidak diubah.

## Arsitektur

```
client ── POST /render (x-api-key) ──▶ Worker (Free)
                                        │ repository_dispatch (event: render-video)
                                        ▼
                              GitHub Actions: render-video.yml
                              Node 22 + FFmpeg → `npx hyperframes render`
                                        │ wrangler r2 object put --remote
                                        ▼
                              R2 bucket `hyperframes-renders`  (renders/<id>.mp4)
                                        ▲
client ◀── GET /video/:id, /status/:id ─┘ (lewat Worker; 404 selama belum selesai)
```

## Isi folder

| Path | Fungsi |
| --- | --- |
| `worker/src/index.js` | Worker: `/render`, `/status/:id`, `/video/:id` |
| `worker/wrangler.jsonc` | Binding R2 `VIDEOS`, var `GITHUB_REPO` |
| `compositions/contoh/` | Komposisi contoh 5 detik (1920×1080) |
| `../.github/workflows/render-video.yml` | Workflow render (dipicu `repository_dispatch` / manual) |
| `../.github/workflows/deploy-worker.yml` | Workflow deploy Worker (manual, `wrangler deploy`) |

Komposisi baru: buat folder `compositions/<nama>/index.html` (format HyperFrames:
root dengan `data-composition-id`, timeline GSAP `paused` yang didaftarkan di
`window.__timelines`). Nama folder harus cocok `^[a-zA-Z0-9_-]{1,64}$`.

## API

| Endpoint | Auth | Keterangan |
| --- | --- | --- |
| `POST /render` | header `x-api-key` | Body JSON opsional: `id`, `composition` (default `contoh`), `quality` (`draft`/`standard`/`high`). `id` kosong → UUID otomatis. Balas `202`. `409` bila `id` sudah ada. |
| `GET /status/:id` | — | `200 {status:"done"}` bila file ada di R2, selain itu `404 {status:"not_ready"}` (antre/render/id tak dikenal tidak dibedakan). |
| `GET /video/:id` | — | Menyajikan MP4 (mendukung Range). `404` selama belum selesai. |

Karena `/status` dan `/video` publik, pakai `id` yang sulit ditebak (biarkan UUID otomatis).

## Setup

1. Bucket: `npx wrangler r2 bucket create hyperframes-renders`
2. GitHub Secrets (Settings → Secrets and variables → Actions):
   `CLOUDFLARE_API_TOKEN` dan `CLOUDFLARE_ACCOUNT_ID`.
   Izin token: *Account → Workers Scripts: Edit* dan *Workers R2 Storage: Edit*.
3. **Aktifkan Actions di fork**: GitHub menonaktifkan workflow di fork secara default.
   Buka tab *Actions* → *I understand my workflows, go ahead and enable them*.
4. Deploy Worker: Actions → *Deploy worker* → *Run workflow*
   (alternatif lokal: `cd cloudflare-free/worker && npx wrangler deploy`).
5. Secret runtime Worker (nilai diketik di prompt, jangan ditulis ke file):
   `npx wrangler secret put GITHUB_TOKEN` dan `npx wrangler secret put API_KEY`
   - `GITHUB_TOKEN`: PAT *fine-grained*, hanya untuk repo fork ini, izin **Contents: Read and write**
     (dibutuhkan endpoint `repository_dispatch`).
   - `API_KEY`: string acak buatan sendiri, mis. `openssl rand -hex 32`.
6. Tes cepat tanpa Worker: Actions → *Render video* → *Run workflow* (`id=tes1`).

## Pemakaian

```bash
WORKER=https://hyperframes-render.<SUBDOMAIN-ANDA>.workers.dev

# 1. minta render (API_KEY = nilai secret API_KEY, simpan di variabel lingkungan)
curl -sS -X POST "$WORKER/render" \
  -H "x-api-key: $API_KEY" -H "content-type: application/json" \
  -d '{"composition":"contoh","quality":"draft"}'

# 2. cek status (ulangi sampai status "done")
curl -sS "$WORKER/status/<id>"

# 3. unduh hasil
curl -sS -o hasil.mp4 "$WORKER/video/<id>"
```

## Batas gratis (perkiraan, cek halaman harga resmi)

- **Workers Free**: 100.000 request/hari, 10 ms CPU per invocation. Satu render = 1 request `/render` + beberapa polling.
- **R2 free tier**: 10 GB-bulan penyimpanan, 1 juta operasi Class A (tulis) dan 10 juta Class B (baca) per bulan, egress gratis. Satu render ≈ 1 tulis; `/status` dan `/video` ≈ 1 baca per panggilan.
- **GitHub Actions**: repo publik memakai runner standar tanpa kuota menit (menurut dokumentasi GitHub); repo privat dibatasi kuota menit akun. Job dibatasi `timeout-minutes: 30`.
- Batas teknis workflow: MP4 maksimal 300 MiB (guard di workflow); durasi/resolusi besar = render lebih lama di runner 4 vCPU.
- R2 tidak menghapus otomatis: hapus `renders/*.mp4` lama bila mendekati 10 GB (atau pasang lifecycle rule di dashboard).

## Keamanan

- Tidak ada token/API key di repo. Rahasia hanya di Worker secrets dan GitHub Secrets.
- Input `id`/`composition`/`quality` divalidasi di Worker **dan** di workflow; di workflow input dilewatkan lewat `env:`, tidak diinterpolasi ke shell.
- Bandingkan `x-api-key` dengan `crypto.subtle.timingSafeEqual`.
- Versi CLI (`hyperframes`, `wrangler`) dan SHA action dipin di workflow; naikkan secara sadar.
- Fork publik: siapa pun bisa membaca workflow, tetapi tanpa `GITHUB_TOKEN` Worker tidak ada yang bisa memicu dispatch.

## Pemecahan masalah

- Dispatch `502`/`github_status: 404`: token salah atau tidak punya akses ke repo; `403`: izin Contents belum *write*.
- Workflow tidak jalan: Actions belum diaktifkan di fork, atau workflow belum ada di default branch.
- Deploy gagal `Authentication error`: izin *Workers Scripts: Edit* belum ada di `CLOUDFLARE_API_TOKEN`.
- Render gagal: lihat step *hyperframes doctor* dan *Render komposisi* di log; jalankan `npx hyperframes lint` lokal pada komposisinya.
- Upload R2 gagal: periksa dua GitHub Secrets Cloudflare dan nama bucket.
