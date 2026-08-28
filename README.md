# Russian Practice

A mobile-friendly web app for practicing Russian, starting with a
listening exercise. Built to be free forever and to scale to thousands
of sentences without bloating the repo — audio is generated **live** on
each tap, never stored.

## How it works

```
[Your phone / GitHub Pages]  --fetch-->  [Backend on Render.com]  --fetch-->  [Microsoft edge-tts]
        (static HTML/JS)                  (Flask + edge-tts)                  (generates MP3)
```

- **Frontend** (`index.html`, `exercises/`, `css/`, `js/`): a static
  site you host for free on GitHub Pages. Reads sentences from
  `data/sentences.json` -- an array of `{ "ru": "...", "en": "..." }` pairs.
- **Backend** (`backend/server.py`): a tiny Flask app with one endpoint,
  `/api/speak`, that calls `edge-tts` and streams the MP3 straight back.
  No files are ever written to disk. Deploy it for free — see
  [`DEPLOY.md`](./DEPLOY.md).

## Project structure

```
.
├── index.html              # Homepage — list of exercises
├── exercises/
│   └── listening.html      # Listening exercise UI
├── css/style.css           # Shared styling
├── js/
│   ├── config.js           # Set your backend URL here
│   └── listening.js        # Listening exercise logic
├── data/
│   └── sentences.json      # Your Russian/English sentence pairs (replace this!)
├── backend/
│   ├── server.py           # Flask app: generates + streams TTS live
│   └── requirements.txt
├── render.yaml              # One-click deploy config for Render.com
└── DEPLOY.md                # Step-by-step deploy guide
```

## Getting started

1. Replace `data/sentences.json` with your own sentence pairs, e.g.:
   ```json
   [
     { "ru": "Собака ест дома.", "en": "The dog is eating at home." },
     { "ru": "Кошка спит на диване.", "en": "The cat is sleeping on the sofa." }
   ]
   ```
   Only ever *append* new entries to the end -- reordering shifts your
   saved progress (which is stored by index in your browser).
2. Deploy the backend — see [`DEPLOY.md`](./DEPLOY.md) (takes ~5 minutes
   on Render's free tier).
3. Set `BACKEND_URL` in `js/config.js` to your deployed backend's URL.
4. Push to GitHub, enable GitHub Pages (Settings → Pages → branch
   `main`, folder `/`).
5. Open the Pages URL on your phone, tap "Listening Practice," and go.

## The listening exercise

- 🔊 **Listen** — generates and plays the current sentence
- 🐢 **Slower** — same sentence at reduced speed
- 👁️ **Show text** — reveals the Cyrillic sentence to check yourself
- **Dmitry / Svetlana** toggle — switch voices anytime
- **Next / Prev** — move through your list; progress is saved locally
  in your browser so you can pick up where you left off

## Adding more exercises later

The homepage (`index.html`) already has placeholder cards for
Dictation, Shadowing, and Flashcards. To add a real one: create a new
page under `exercises/`, link it from `index.html`, and give its card
the `available` class instead of `disabled`.
