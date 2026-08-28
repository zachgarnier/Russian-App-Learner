# Deploying the backend (free)

The frontend (this repo, minus `backend/`) is a static site — put it on
GitHub Pages as usual: **Settings → Pages → deploy from branch `main`,
folder `/`**. Your app will be at `https://<username>.github.io/<repo>/`.

The backend needs to actually run somewhere, since it makes a real
network call to Microsoft's TTS service. Render.com's free tier is the
easiest option and costs nothing.

## Option A: Render.com (recommended, free)

1. Push this whole repo to GitHub (including the `backend/` folder and
   `render.yaml`).
2. Go to https://render.com → New → **Blueprint** → connect your repo.
   Render will read `render.yaml` and set everything up automatically.
   (Alternatively: New → **Web Service** → connect repo → set:
   - Root directory: leave blank
   - Build command: `pip install -r backend/requirements.txt`
   - Start command: `cd backend && gunicorn server:app`
   - Plan: Free
   )
3. Once deployed, Render gives you a URL like
   `https://russian-tts-backend.onrender.com`.
4. Open `js/config.js` in this repo and set:
   ```js
   const BACKEND_URL = "https://russian-tts-backend.onrender.com";
   ```
5. Commit and push. GitHub Pages will pick up the change.

**Note on the free tier:** Render's free web services "sleep" after 15
minutes of no traffic and take ~30-50 seconds to wake up on the next
request. That means the very first "Listen" tap after a while idle will
be slow — after that it's fast until it sleeps again. This is fine for a
personal practice app. If that's annoying, options are: a paid Render
plan ($7/mo, always on), Fly.io (also has a free tier with a similar
sleep behavior), or a $5/mo VPS you keep running yourself.

## Option B: Run it on a machine you own

If you have a Raspberry Pi, home server, or a VPS, you can just run:

```bash
cd backend
pip install -r requirements.txt
gunicorn server:app --bind 0.0.0.0:5000
```

behind a reverse proxy with HTTPS (e.g. Caddy or nginx + Let's Encrypt —
this matters because GitHub Pages is served over HTTPS, and browsers
block a HTTPS page from calling an HTTP backend). Then point
`BACKEND_URL` at that server's public HTTPS address.

## Testing locally before deploying

```bash
cd backend
pip install -r requirements.txt
python3 server.py
```

Leave `BACKEND_URL = "http://localhost:5000"` in `js/config.js`, then
serve the frontend locally too (in a second terminal, from the repo
root):

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000` in your browser (not `file://` — browsers
block `fetch()` of local files under `file://`, so you need a real,
even if local, HTTP server).
