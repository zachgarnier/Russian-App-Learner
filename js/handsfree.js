// handsfree.js
//
// A Bluetooth-remote-controlled version of the listening exercise, meant
// to be used with the phone locked/pocketed and a Bluetooth headset (e.g.
// Shokz) doing the driving. It uses the standard Web "Media Session API"
// to receive the headset's play/pause, next-track and previous-track
// button presses -- the same API every podcast/music PWA uses for lock
// screen controls.
//
//   1 press (play/pause) -> toggle the auto-repeating Russian loop
//                            (plays now, then again every REPEAT_GAP_MS,
//                            until you press it again to stop)
//   2 presses (next track) -> advance to the next sentence AND
//                              immediately start the loop for it
//   3 presses (previous track) -> play the English translation once,
//                                  then the loop (if it was running)
//                                  picks back up where it left off
//
// >>> TO CHANGE THE PAUSE BETWEEN REPEATS, edit DEFAULT_REPEAT_GAP_SECONDS
// >>> below, or use the "Repeat pause" field in the app itself.
const DEFAULT_REPEAT_GAP_SECONDS = 5;

// Two things make this actually work with the screen off / app
// backgrounded on a phone:
//   1. A persistent, silent, looping <audio> element (#hf-keepalive).
//      Mobile browsers suspend background tabs once nothing is playing;
//      keeping *something* audible-to-the-OS (even at ~0 volume) is what
//      keeps the tab alive and keeps the remote-control events flowing.
//   2. navigator.mediaSession.setActionHandler(...) registered once,
//      kept registered for the whole session, with playbackState kept
//      in sync so the headset's single button correctly toggles between
//      sending "play" and sending "pause".

const els = {
  progress: document.getElementById("hf-progress"),
  prestart: document.getElementById("hf-prestart"),
  live: document.getElementById("hf-live"),
  startBtn: document.getElementById("hf-start-btn"),

  orb: document.getElementById("hf-orb"),
  status: document.getElementById("hf-status"),

  btnRussian: document.getElementById("hf-btn-russian"),
  btnSlow: document.getElementById("hf-btn-slow"),
  btnTranslate: document.getElementById("hf-btn-translate"),
  btnNext: document.getElementById("hf-btn-next"),

  gapInput: document.getElementById("hf-gap-input"),

  complete: document.getElementById("hf-complete"),
  completeSummary: document.getElementById("hf-complete-summary"),
  bonusBtn: document.getElementById("hf-bonus-btn"),

  statusLine: document.getElementById("hf-status-line"),
  keepAlive: document.getElementById("hf-keepalive"),
};

const VOICES = ["dmitry", "svetlana"];
const GAP_STORAGE_KEY = "ruHandsfreeGapSeconds";

let sentences = [];
let currentIndex = null;
let repeatGapMs = DEFAULT_REPEAT_GAP_SECONDS * 1000;

let autoPlaying = false; // is the Russian repeat-loop armed?
let autoLoopTimer = null; // setTimeout handle for the gap between repeats
let currentPlaybackAudio = null; // the Audio() currently playing, if any
let translationInFlight = false;

const cardAudioCache = {}; // cardAudioCache[index] = { voice, blobs: { normal, slow } }

function pickRandomVoice() {
  return VOICES[Math.floor(Math.random() * VOICES.length)];
}

function getOrCreateAudioEntry(index) {
  if (!cardAudioCache[index]) {
    cardAudioCache[index] = { voice: pickRandomVoice(), blobs: {} };
  }
  return cardAudioCache[index];
}

function setStatusLine(message, isError) {
  els.statusLine.textContent = message || "";
  els.statusLine.classList.toggle("error", !!isError);
}

function setStage(text, icon) {
  els.status.textContent = text;
  if (icon) els.orb.textContent = icon;
}

function updateRussianButtonLabel() {
  els.btnRussian.innerHTML = autoPlaying
    ? '<span class="hf-btn-icon">⏹️</span> Stop'
    : '<span class="hf-btn-icon">🔊</span> Russian';
}

// ---------- Repeat-gap setting ----------

function loadGapSetting() {
  const saved = parseFloat(localStorage.getItem(GAP_STORAGE_KEY));
  const seconds = Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_REPEAT_GAP_SECONDS;
  repeatGapMs = seconds * 1000;
  if (els.gapInput) els.gapInput.value = seconds;
}

function saveGapSetting(seconds) {
  const clamped = Math.min(30, Math.max(1, seconds || DEFAULT_REPEAT_GAP_SECONDS));
  repeatGapMs = clamped * 1000;
  localStorage.setItem(GAP_STORAGE_KEY, String(clamped));
}

// ---------- Keep-alive loop ----------
//
// Ducking pattern: pause the silent loop while a real clip plays, resume
// it the moment that clip ends. The loop is what keeps the background
// audio/media session alive between sentences.

function pauseKeepAlive() {
  try {
    els.keepAlive.pause();
  } catch (e) {
    /* ignore */
  }
}

function resumeKeepAlive() {
  els.keepAlive.play().catch(() => {
    /* Will resume on the next user-triggered action if this fails. */
  });
}

// ---------- Media Session wiring ----------

function updateMediaSessionMetadata() {
  if (!("mediaSession" in navigator)) return;
  const session = RuProgress.getSession();
  const total = session ? session.target : 0;
  const done = session ? session.completed : 0;
  // Deliberately generic (no Russian/English text) so a glance at the
  // lock screen doesn't spoil the answer.
  navigator.mediaSession.metadata = new MediaMetadata({
    title: "Russian Listening Practice",
    artist: `Card ${Math.min(done + 1, Math.max(total, 1))} of ${total}`,
    album: "Hands-free mode",
  });
}

function syncMediaSessionPlaybackState() {
  if (!("mediaSession" in navigator)) return;
  // This is what lets a single headset button correctly alternate
  // between sending "play" (when we report "paused") and "pause"
  // (when we report "playing").
  navigator.mediaSession.playbackState = autoPlaying ? "playing" : "paused";
}

function setupMediaSession() {
  if (!("mediaSession" in navigator)) {
    setStatusLine(
      "Your browser doesn't support the Media Session API, so the on-screen buttons still work, but the Shokz buttons won't be wired up.",
      true
    );
    return;
  }

  try {
    navigator.mediaSession.setActionHandler("play", () => startAutoLoop());
    navigator.mediaSession.setActionHandler("pause", () => stopAutoLoop());
    navigator.mediaSession.setActionHandler("nexttrack", () => goNext());
    navigator.mediaSession.setActionHandler("previoustrack", () => playTranslation());
  } catch (err) {
    console.error("MediaSession action handlers not fully supported", err);
  }
}

// ---------- Data loading ----------

async function loadSentences() {
  const res = await fetch("../data/sentences.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load sentences.json (${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("sentences.json must be an array");

  sentences = data
    .filter((item) => item && typeof item.ru === "string" && item.ru.trim().length > 0)
    .map((item) => ({ ru: item.ru.trim(), en: (item.en || "").trim() }));

  RuProgress.ensureSession(sentences.length, RuProgress.DEFAULT_SESSION_SIZE);
}

// ---------- Card flow ----------

function renderProgress() {
  const session = RuProgress.getSession();
  if (!session) {
    els.progress.textContent = "Card — / —";
    return;
  }
  els.progress.textContent = `Card ${Math.min(session.completed + 1, session.target)} of ${session.target}`;
}

function loadCurrentCard() {
  currentIndex = RuProgress.getCurrentCardIndex();
  renderProgress();

  if (currentIndex === null || RuProgress.isSessionComplete()) {
    stopAutoLoop();
    showComplete();
    return false;
  }

  els.live.style.display = "flex";
  els.complete.style.display = "none";
  updateMediaSessionMetadata();
  return true;
}

function showComplete() {
  els.live.style.display = "none";
  els.complete.style.display = "flex";
  const session = RuProgress.getSession();
  els.completeSummary.textContent = `You got through ${session ? session.completed : 0} sentence${
    session && session.completed === 1 ? "" : "s"
  } today.`;
}

// Stops any in-flight/scheduled Russian playback without touching
// autoPlaying's target state -- used internally before switching cards
// or playing a one-off (slow / translation).
function haltPlayback() {
  if (autoLoopTimer) {
    clearTimeout(autoLoopTimer);
    autoLoopTimer = null;
  }
  if (currentPlaybackAudio) {
    try {
      currentPlaybackAudio.pause();
    } catch (e) {
      /* ignore */
    }
    currentPlaybackAudio = null;
  }
}

function goNext() {
  if (currentIndex === null) return;
  haltPlayback();
  // Hands-free "next" is a plain advance, not a graded answer -- it
  // counts as "reviewed" for the spaced-repetition queue. Use the
  // graded swipe mode in regular Listening Practice for know/don't-know.
  RuProgress.recordAnswer(currentIndex, true);
  const hasCard = loadCurrentCard();
  if (hasCard) startAutoLoop(); // per your request: next always starts playing immediately
}

// ---------- Audio: Russian (backend TTS, cached), single play ----------

async function playRussianClip(slow) {
  if (currentIndex === null) return;
  const idx = currentIndex;
  const current = sentences[idx];
  if (!current) return;

  const entry = getOrCreateAudioEntry(idx);
  const cacheKey = slow ? "slow" : "normal";

  setStage(slow ? "Playing slow Russian…" : "Playing Russian…", "🔊");
  pauseKeepAlive();

  try {
    let blob = entry.blobs[cacheKey];
    if (!blob) {
      setStatusLine("Generating audio…");
      const params = new URLSearchParams({ text: current.ru, voice: entry.voice, slow: slow ? "1" : "0" });
      const res = await fetch(`${BACKEND_URL}/api/speak?${params.toString()}`);
      if (!res.ok) throw new Error(`Backend error ${res.status}`);
      blob = await res.blob();
      entry.blobs[cacheKey] = blob;
    }
    setStatusLine("");

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentPlaybackAudio = audio;

    await new Promise((resolve) => {
      const cleanup = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.addEventListener("ended", cleanup, { once: true });
      audio.addEventListener("error", cleanup, { once: true });
      audio.addEventListener("pause", cleanup, { once: true }); // covers manual interruption
      audio.play().catch(cleanup);
    });
  } catch (err) {
    console.error(err);
    setStatusLine("Couldn't reach the backend for audio. Check js/config.js / that it's deployed.", true);
  } finally {
    if (currentPlaybackAudio) currentPlaybackAudio = null;
    resumeKeepAlive();
  }
}

// ---------- Auto-repeat loop ----------

function scheduleNextLoopIteration() {
  if (!autoPlaying) return;
  setStage(`Repeating in ${Math.round(repeatGapMs / 1000)}s…`, "⏳");
  autoLoopTimer = setTimeout(async () => {
    autoLoopTimer = null;
    if (!autoPlaying) return;
    await playRussianClip(false);
    if (autoPlaying) {
      setStage("Playing Russian…", "🔊"); // brief settle before next schedule call overwrites it
      scheduleNextLoopIteration();
    }
  }, repeatGapMs);
}

async function startAutoLoop() {
  if (autoPlaying) return; // already running, ignore duplicate "play"
  autoPlaying = true;
  syncMediaSessionPlaybackState();
  updateRussianButtonLabel();
  await playRussianClip(false);
  if (autoPlaying) scheduleNextLoopIteration();
}

function stopAutoLoop() {
  autoPlaying = false;
  haltPlayback();
  syncMediaSessionPlaybackState();
  updateRussianButtonLabel();
  setStage("Stopped — press play to resume", "⏸️");
}

function toggleAutoLoop() {
  if (autoPlaying) stopAutoLoop();
  else startAutoLoop();
}

// ---------- Audio: English translation (on-device speech synthesis) ----------

function playTranslation() {
  if (currentIndex === null || translationInFlight) return;
  const current = sentences[currentIndex];
  if (!current || !current.en) return;

  if (!("speechSynthesis" in window)) {
    setStatusLine("Your browser doesn't support on-device text-to-speech for the translation.", true);
    return;
  }

  const wasAutoPlaying = autoPlaying;
  // Pause the loop's schedule (without changing the "armed" state) so it
  // doesn't fire a Russian repeat mid-translation.
  if (autoLoopTimer) {
    clearTimeout(autoLoopTimer);
    autoLoopTimer = null;
  }

  translationInFlight = true;
  setStage("Playing translation…", "🇬🇧");
  pauseKeepAlive();

  const utterance = new SpeechSynthesisUtterance(current.en);
  utterance.lang = "en-US";
  utterance.rate = 1;

  const finish = () => {
    translationInFlight = false;
    resumeKeepAlive();
    if (wasAutoPlaying && autoPlaying) {
      scheduleNextLoopIteration(); // pick the repeat loop back up
    } else {
      setStage("Ready", "🇷🇺");
    }
  };

  utterance.addEventListener("end", finish, { once: true });
  utterance.addEventListener("error", finish, { once: true });

  window.speechSynthesis.cancel(); // clear any stuck queue
  window.speechSynthesis.speak(utterance);
}

// ---------- Start flow ----------

async function startSession() {
  els.startBtn.disabled = true;
  try {
    await loadSentences();
  } catch (err) {
    console.error(err);
    setStatusLine("Could not load sentences.json — check it exists and you're serving over http(s).", true);
    els.startBtn.disabled = false;
    return;
  }

  els.prestart.style.display = "none";

  // This play() call happens inside the button's click handler, so it
  // counts as a "user gesture" and satisfies the browser's autoplay
  // policy -- required to unlock both the keep-alive audio loop and
  // speechSynthesis for the rest of the session.
  els.keepAlive.volume = 0.01;
  try {
    await els.keepAlive.play();
  } catch (err) {
    console.error("Could not start keep-alive audio", err);
  }

  setupMediaSession();
  const hasCard = loadCurrentCard();
  if (hasCard) startAutoLoop(); // clicking Start = clicking play
}

// ---------- Event wiring ----------

loadGapSetting();

els.startBtn.addEventListener("click", startSession);
els.btnRussian.addEventListener("click", toggleAutoLoop);
els.btnSlow.addEventListener("click", () => {
  if (autoLoopTimer) {
    clearTimeout(autoLoopTimer);
    autoLoopTimer = null;
  }
  playRussianClip(true).then(() => {
    if (autoPlaying) scheduleNextLoopIteration();
  });
});
els.btnTranslate.addEventListener("click", () => playTranslation());
els.btnNext.addEventListener("click", () => goNext());
els.bonusBtn.addEventListener("click", () => {
  RuProgress.extendSession(10);
  loadCurrentCard();
});

if (els.gapInput) {
  els.gapInput.addEventListener("change", () => {
    saveGapSetting(parseFloat(els.gapInput.value));
  });
}
