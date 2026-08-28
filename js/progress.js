// progress.js
//
// Client-side progress tracking for the listening exercise. Everything
// lives in localStorage under one key -- no account, no backend, single
// device. If you ever want this synced across devices, the natural next
// step is pushing this same JSON blob to the Flask backend, but that's
// not needed for a single-user app.
//
// Spaced repetition model (Leitner-ish):
//   - Every sentence has a "box" from 0 (new/hardest) to MASTER_BOX (mastered).
//   - Swipe right ("I know it") -> box goes up, next review scheduled
//     further in the future (1, 2, 4, 8, 16, 30 days as box increases).
//   - Swipe left ("Again") -> box goes down, card becomes due again
//     almost immediately (and may resurface later in TODAY's session).
//
// Daily session:
//   - A fixed-size queue of due/new cards is built once per calendar day.
//   - Only right-swipes count toward the daily goal, so you can't pad
//     the count by swiping left through everything.
//   - Left-swiped cards get requeued near-term (a couple of extra
//     chances today) before falling back to normal spaced-repetition
//     scheduling.

(function () {
  const STORAGE_KEY = "ruProgressV1";
  const MASTER_BOX = 6;
  const INTERVALS_DAYS = [1, 2, 4, 8, 16, 30]; // index by (box - 1) for box = 1..6
  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_SESSION_SIZE = 20;
  const MAX_FAILS_REQUEUED_PER_DAY = 2;

  function todayStr(d) {
    d = d || new Date();
    return d.toISOString().slice(0, 10);
  }

  function freshState() {
    return {
      cards: {}, // index (string) -> { box, due, failsToday }
      streak: { count: 0, lastDay: null },
      totalSentences: null,
      session: null, // { date, queue: [idx...], completed, target, again }
      history: {}, // date -> { completed }
    };
  }

  function loadRaw() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Guard against a corrupted/older shape.
      if (!parsed || typeof parsed !== "object" || !parsed.cards) return null;
      return parsed;
    } catch (e) {
      console.error("progress: failed to load, resetting", e);
      return null;
    }
  }

  function saveRaw(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("progress: failed to save", e);
    }
  }

  function getState() {
    return loadRaw() || freshState();
  }

  function setTotalSentences(n) {
    const s = getState();
    s.totalSentences = n;
    saveRaw(s);
  }

  function getOverallStats() {
    const s = getState();
    const cardsArr = Object.values(s.cards);
    const mastered = cardsArr.filter((c) => c.box >= MASTER_BOX).length;
    const seen = cardsArr.length;
    const total = s.totalSentences || 0;
    const pct = total > 0 ? Math.round((mastered / total) * 1000) / 10 : 0;
    return { mastered, seen, total, pct };
  }

  function getStreak() {
    const s = getState();
    return (s.streak && s.streak.count) || 0;
  }

  function bumpStreakIfNeeded(s) {
    const today = todayStr();
    if (s.streak.lastDay === today) return;
    const yesterday = todayStr(new Date(Date.now() - DAY_MS));
    if (s.streak.lastDay === yesterday) {
      s.streak.count = (s.streak.count || 0) + 1;
    } else {
      s.streak.count = 1;
    }
    s.streak.lastDay = today;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function buildQueue(s, totalSentences, size) {
    const now = Date.now();
    const due = [];
    const untouched = [];

    for (let i = 0; i < totalSentences; i++) {
      const c = s.cards[i];
      if (!c) {
        untouched.push(i);
      } else if (c.box < MASTER_BOX && c.due <= now) {
        due.push({ i, due: c.due });
      }
    }

    due.sort((a, b) => a.due - b.due); // most overdue first
    const queue = due.map((d) => d.i);

    shuffle(untouched); // new cards in random order, for variety

    while (queue.length < size && untouched.length) {
      queue.push(untouched.shift());
    }

    return queue.slice(0, Math.max(size, 0));
  }

  function ensureSession(totalSentences, sessionSize) {
    sessionSize = sessionSize || DEFAULT_SESSION_SIZE;
    const s = getState();
    s.totalSentences = totalSentences;
    const today = todayStr();

    if (!s.session || s.session.date !== today) {
      s.session = {
        date: today,
        queue: buildQueue(s, totalSentences, sessionSize),
        completed: 0,
        target: sessionSize,
        again: 0,
      };
    }

    saveRaw(s);
    return s.session;
  }

  function getSession() {
    return getState().session;
  }

  function getCurrentCardIndex() {
    const s = getState();
    if (!s.session || s.session.queue.length === 0) return null;
    return s.session.queue[0];
  }

  function isSessionComplete() {
    const s = getState();
    if (!s.session) return false;
    return s.session.completed >= s.session.target;
  }

  function extendSession(extra) {
    const s = getState();
    if (!s.session) return;
    s.session.target += extra;

    const totalSentences = s.totalSentences || 0;
    if (s.session.queue.length < extra) {
      const more = buildQueue(s, totalSentences, extra);
      // Avoid re-adding cards already sitting in the queue.
      const existing = new Set(s.session.queue);
      for (const idx of more) {
        if (!existing.has(idx)) s.session.queue.push(idx);
      }
    }
    saveRaw(s);
  }

  function recordAnswer(index, knewIt) {
    const s = getState();
    const key = String(index);
    if (!s.cards[key]) s.cards[key] = { box: 0, due: Date.now(), failsToday: 0 };
    const card = s.cards[key];
    const now = Date.now();

    if (knewIt) {
      card.box = Math.min(MASTER_BOX, card.box + 1);
      const dayIdx = Math.max(0, Math.min(INTERVALS_DAYS.length - 1, card.box - 1));
      card.due = now + INTERVALS_DAYS[dayIdx] * DAY_MS;
      if (s.session) s.session.completed += 1;
    } else {
      card.box = Math.max(0, card.box - 1);
      card.due = now;
      card.failsToday = (card.failsToday || 0) + 1;
      if (s.session) {
        s.session.again += 1;
        if (card.failsToday <= MAX_FAILS_REQUEUED_PER_DAY) {
          s.session.queue.push(index);
        }
      }
    }

    if (s.session) {
      if (s.session.queue[0] === index) {
        s.session.queue.shift();
      } else {
        const pos = s.session.queue.indexOf(index);
        if (pos >= 0) s.session.queue.splice(pos, 1);
      }
    }

    bumpStreakIfNeeded(s);

    const today = todayStr();
    if (!s.history[today]) s.history[today] = { completed: 0 };
    if (knewIt) s.history[today].completed += 1;

    saveRaw(s);
  }

  window.RuProgress = {
    MASTER_BOX,
    DEFAULT_SESSION_SIZE,
    getState,
    setTotalSentences,
    getOverallStats,
    getStreak,
    getSession,
    ensureSession,
    getCurrentCardIndex,
    isSessionComplete,
    extendSession,
    recordAnswer,
  };
})();
