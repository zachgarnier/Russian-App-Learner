// handsfree.js
//
// A Bluetooth-remote-controlled version of the listening exercise, meant
// to be used with the phone locked/pocketed and a Bluetooth headset (e.g.
// Shokz) doing the driving. It uses the standard Web "Media Session API"
// to receive the headset's play/pause, next-track and previous-track
// button presses -- the same API every podcast/music PWA uses for lock
// screen controls. Nothing here is Shokz-specific; it's just three
// generic Bluetooth remote-control (AVRCP) commands most headsets send:
//
//   1 press (play/pause) -> play the sentence in Russian
//   2 presses (next track) -> advance to the next sentence
//   3 presses (previous track) -> play the English translation
//
// "Slow Russian" only has an on-screen button for now, because most
// remotes only expose those three commands (see the chat reply for how
// to add a fourth mapping if your headset supports more).
//
// Two things make this actually work with the screen off / app
// backgrounded on a phone:
//   1. A persistent, silent, looping <audio> element (#hf-keepalive).
//      Mobile browsers suspend background tabs once nothing is playing;
//      keeping *something* audible-to-the-OS (even at ~0 volume) is what
//      keeps the tab alive and keeps the remote-control events flowing.
//   2. navigator.mediaSession.setActionHandler(...) registered once,
//      kept registered for the whole session.

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

  complete: document.getElementById("hf-complete"),
  completeSummary: document.getElementById("hf-complete-summary"),
  bonusBtn: document.getElementById("hf-bonus-btn"),

  statusLine: document.getElementById("hf-status-line"),
  keepAlive: document.getElementById("hf-keepalive"),
};

const VOICES = ["dmitry", "svetlana"];

let sentences = [];
let currentIndex = null;
let busy = false; // true while audio is generating/playing, to ignore rapid double-presses
const cardAudioCache = {}; // same shape as listening.js's cache

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

function setBusy(isBusy) {
  busy = isBusy;
  els.orb.classList.toggle("active", isBusy);
  [els.btnRussian, els.btnSlow, els.btnTranslate, els.btnNext].forEach((b) => {
    b.disabled = isBusy;
  });
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
  navigator.mediaSession.playbackState = "playing";
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
    navigator.mediaSession.setActionHandler("play", () => playRussian(false));
    navigator.mediaSession.setActionHandler("nexttrack", () => goNext());
    navigator.mediaSession.setActionHandler("previoustrack", () => playTranslation());
    // "pause" fires if the remote is pressed while our keep-alive audio is
    // reported as playing. We just treat it the same as "play" (replay
    // the current sentence) so an accidental double-tap doesn't do nothing.
    navigator.mediaSession.setActionHandler("pause", () => playRussian(false));
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
    showComplete();
    return;
  }

  els.live.style.display = "flex";
  els.complete.style.display = "none";
  setStage("Ready — press play on your headset", "🇷🇺");
  updateMediaSessionMetadata();
}

function showComplete() {
  els.live.style.display = "none";
  els.complete.style.display = "flex";
  const session = RuProgress.getSession();
  els.completeSummary.textContent = `You got through ${session ? session.completed : 0} sentence${
    session && session.completed === 1 ? "" : "s"
  } today.`;
}

function goNext() {
  if (currentIndex === null || busy) return;
  // Hands-free "next" is a plain advance, not a graded answer -- it counts
  // as "reviewed" for the spaced-repetition queue. If you want to mark a
  // card as NOT known instead, use the graded swipe mode in the regular
  // Listening Practice screen.
  RuProgress.recordAnswer(currentIndex, true);
  loadCurrentCard();
}

// ---------- Audio: Russian (backend TTS, cached) ----------

function playBlob(blob) {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.addEventListener("ended", () => URL.revokeObjectURL(url));
  audio.addEventListener("error", () => URL.revokeObjectURL(url));
  return { audio, playPromise: audio.play() };
}

async function playRussian(slow) {
  if (currentIndex === null || busy) return;
  const idx = currentIndex;
  const current = sentences[idx];
  if (!current) return;

  const entry = getOrCreateAudioEntry(idx);
  const cacheKey = slow ? "slow" : "normal";

  setBusy(true);
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
    const { audio, playPromise } = playBlob(blob);
    await playPromise;
    await new Promise((resolve) => {
      audio.addEventListener("ended", resolve, { once: true });
      audio.addEventListener("error", resolve, { once: true });
    });
  } catch (err) {
    console.error(err);
    setStatusLine("Couldn't reach the backend for audio. Check js/config.js / that it's deployed.", true);
  } finally {
    setStage("Ready", "🇷🇺");
    setBusy(false);
    resumeKeepAlive();
    updateMediaSessionMetadata();
  }
}

// ---------- Audio: English translation (on-device speech synthesis) ----------

function playTranslation() {
  if (currentIndex === null || busy) return;
  const current = sentences[currentIndex];
  if (!current || !current.en) return;

  if (!("speechSynthesis" in window)) {
    setStatusLine("Your browser doesn't support on-device text-to-speech for the translation.", true);
    return;
  }

  setBusy(true);
  setStage("Playing translation…", "🇬🇧");
  pauseKeepAlive();

  const utterance = new SpeechSynthesisUtterance(current.en);
  utterance.lang = "en-US";
  utterance.rate = 1;

  const finish = () => {
    setStage("Ready", "🇷🇺");
    setBusy(false);
    resumeKeepAlive();
    updateMediaSessionMetadata();
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
  loadCurrentCard();
}

// ---------- Event wiring ----------

els.startBtn.addEventListener("click", startSession);
els.btnRussian.addEventListener("click", () => playRussian(false));
els.btnSlow.addEventListener("click", () => playRussian(true));
els.btnTranslate.addEventListener("click", () => playTranslation());
els.btnNext.addEventListener("click", () => goNext());
els.bonusBtn.addEventListener("click", () => {
  RuProgress.extendSession(10);
  loadCurrentCard();
});
