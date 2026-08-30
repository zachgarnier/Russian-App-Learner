// progress.js
//
// Client-side progress tracking. Everything lives in localStorage under
// one key -- no account, no backend, single device.
//
// Simple 3-state model (no streaks, no daily goal, no spaced-repetition
// boxes/due-dates):
//   - Every sentence is either "new" (never answered), "failed" (last
//     answer was wrong / "again"), or "success" (last answer was right).
//   - The progress bar shown in the UI is just a live count of how many
//     sentences are currently in the "success" pile out of the total.
//
// Picking the next card (pickNextIndex) uses simple weighted odds
// across those three pools:
//   70% -> a fresh sentence that's never been seen
//   20% -> a sentence currently sitting in "failed" (an "again" card)
//   10% -> a sentence currently sitting in "success" (a spot-check
//          review -- if you get it wrong this time it drops back into
//          "failed", and the progress bar count goes back down by one
//          since the bar is just counting "success" sentences live)
//
// If the chosen pool happens to be empty (e.g. nothing has ever failed
// yet), it falls back down the chain new -> failed -> success so you
// always get a card as long as there's at least one sentence.

(function () {
  const STORAGE_KEY = "ruProgressV2";

  function freshState() {
    return {
      cards: {}, // index (string) -> "failed" | "success" ; absent = "new"
      totalSentences: null,
    };
  }

  function loadRaw() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
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

  // The one number the UI cares about: how many sentences are currently
  // marked "success", out of the total sentence count.
  function getOverallStats() {
    const s = getState();
    const values = Object.values(s.cards);
    const success = values.filter((v) => v === "success").length;
    const failed = values.filter((v) => v === "failed").length;
    const total = s.totalSentences || 0;
    const pct = total > 0 ? Math.round((success / total) * 1000) / 10 : 0;
    return { success, failed, total, pct };
  }

  function getCardState(index) {
    const s = getState();
    return s.cards[String(index)] || "new";
  }

  function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Weighted pick across the new/failed/success pools (70/20/10). Falls
  // back down the chain if the rolled pool is empty. Returns null only
  // if there are zero sentences total.
  function pickNextIndex(totalSentences) {
    if (!totalSentences) return null;
    const s = getState();

    const newPool = [];
    const failedPool = [];
    const successPool = [];
    for (let i = 0; i < totalSentences; i++) {
      const state = s.cards[String(i)];
      if (state === "failed") failedPool.push(i);
      else if (state === "success") successPool.push(i);
      else newPool.push(i);
    }

    const roll = Math.random();
    const order =
      roll < 0.7
        ? [newPool, failedPool, successPool]
        : roll < 0.9
        ? [failedPool, newPool, successPool]
        : [successPool, newPool, failedPool];

    for (const pool of order) {
      if (pool.length) return randomFrom(pool);
    }
    return null; // shouldn't happen when totalSentences > 0
  }

  // Records a yes/no answer for a *graded* card (the swipe exercise).
  // Hands-free mode deliberately never calls this -- advancing through
  // a sentence there doesn't grade it, so it stays "new" until you
  // actually answer it in the regular Listening Practice exercise.
  function recordAnswer(index, knewIt) {
    const s = getState();
    const key = String(index);
    s.cards[key] = knewIt ? "success" : "failed";
    saveRaw(s);
  }

  window.RuProgress = {
    setTotalSentences,
    getOverallStats,
    getCardState,
    pickNextIndex,
    recordAnswer,
  };
})();
