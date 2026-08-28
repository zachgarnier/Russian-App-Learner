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

This isn't a flat "1 / 10,000" list — it's built around **spaced
repetition** so you can actually work through a large sentence bank
without it feeling endless:

- **Swipe right** ("I know it") or **swipe left** ("Again") on each
  card — or use the ✅ / ✖️ buttons if you're on desktop. Swiping right
  sends the sentence further out on a review schedule (1, 2, 4, 8, 16,
  then 30 days). Swiping left brings it back soon, sometimes even later
  in the *same* session.
- **Daily goal**: a ring shows today's progress (e.g. 12/20). Only
  right-swipes count toward it, so you can't pad the number by
  swiping left through everything.
- **Streak**: a 🔥 counter for consecutive days practiced.
- **Overall progress**: a slim bar showing how many of your 10,000 (or
  however many) sentences are fully "mastered" — de-emphasized on
  purpose so the big number doesn't feel discouraging day to day.
- **Session complete screen**: once you hit today's goal, a small
  celebration with stats and an optional "bonus round" (+10 more).
- 🔊 **Listen** / 🐢 **Slower** / 👁️ **Show text** work as before.

All of this progress (per-sentence review schedule, streak, daily
session state) is stored in your browser's `localStorage` — no
account, single device, nothing sent anywhere. See `js/progress.js` for
the full spaced-repetition logic if you want to tweak the intervals,
daily goal size, or requeue behavior.

## Adding more exercises later

The homepage (`index.html`) already has placeholder cards for
Dictation, Shadowing, and Flashcards. To add a real one: create a new
page under `exercises/`, link it from `index.html`, and give its card
the `available` class instead of `disabled`.
