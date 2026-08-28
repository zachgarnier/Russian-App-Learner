// listening.js
//
// Loads the sentence list from data/sentences.json -- an array of
// { "ru": "...", "en": "..." } pairs -- and drives the listening
// exercise.
//
// Voice: each sentence gets ONE randomly-picked voice (Dmitry or
// Svetlana) the first time it's played. That choice -- and the
// generated audio itself -- is cached in memory for the rest of the
// session, so replaying the same card (even 3-4 times) never calls the
// backend again. Moving to a different card and back still uses the
// cached audio. Nothing persists after a page reload -- it's a plain
// in-memory cache, not storage.

const els = {
  listenBtn: document.getElementById("listen-btn"),
  listenHint: document.getElementById("listen-hint"),
  slowerBtn: document.getElementById("slower-btn"),
  revealBtn: document.getElementById("reveal-btn"),
  revealBox: document.getElementById("reveal-box"),
  nextBtn: document.getElementById("next-btn"),
  prevBtn: document.getElementById("prev-btn"),
  progressLabel: document.getElementById("progress-label"),
  progressFill: document.getElementById("progress-fill"),
  voiceLabel: document.getElementById("voice-label"),
  statusLine: document.getElementById("status-line"),
};

const STORAGE_KEY_INDEX = "ru_listening_index";
const VOICES = ["dmitry", "svetlana"];

let sentences = [];
let currentIndex = 0;
let revealed = false;

// In-memory cache, cleared on page reload.
// cardCache[index] = { voice: "dmitry" | "svetlana", blobs: { normal: Blob, slow: Blob } }
const cardCache = {};

function pickRandomVoice() {
  return VOICES[Math.floor(Math.random() * VOICES.length)];
}

function getOrCreateCacheEntry(index) {
  if (!cardCache[index]) {
    cardCache[index] = { voice: pickRandomVoice(), blobs: {} };
  }
  return cardCache[index];
}

function setStatus(message, isError = false) {
  els.statusLine.textContent = message || "";
  els.statusLine.classList.toggle("error", isError);
}

function updateVoiceLabel() {
  const entry = cardCache[currentIndex];
  if (entry) {
    els.voiceLabel.textContent = entry.voice === "dmitry" ? "🎙️ Dmitry" : "🎙️ Svetlana";
  } else {
    els.voiceLabel.textContent = "";
  }
}

function updateProgressUI() {
  const total = sentences.length;
  els.progressLabel.textContent = `${currentIndex + 1} / ${total}`;
  const pct = total > 0 ? ((currentIndex + 1) / total) * 100 : 0;
  els.progressFill.style.width = `${pct}%`;
}

function updateRevealUI() {
  const current = sentences[currentIndex];
  if (revealed && current) {
    els.revealBox.innerHTML = "";
    els.revealBox.classList.remove("hidden-text");

    const ruLine = document.createElement("div");
    ruLine.className = "reveal-ru";
    ruLine.textContent = current.ru;

    const enLine = document.createElement("div");
    enLine.className = "reveal-en";
    enLine.textContent = current.en;

    els.revealBox.appendChild(ruLine);
    els.revealBox.appendChild(enLine);
  } else {
    els.revealBox.textContent = 'Text hidden — tap "Show text" to reveal';
    els.revealBox.classList.add("hidden-text");
  }
}

function goToIndex(newIndex) {
  const total = sentences.length;
  if (total === 0) return;
  currentIndex = ((newIndex % total) + total) % total;
  revealed = false;
  localStorage.setItem(STORAGE_KEY_INDEX, String(currentIndex));
  updateProgressUI();
  updateRevealUI();
  updateVoiceLabel();
  setStatus("");
}

async function loadSentences() {
  try {
    const res = await fetch("../data/sentences.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load sentences.json (${res.status})`);
    const data = await res.json();

    if (!Array.isArray(data)) {
      throw new Error("sentences.json must be a JSON array of { ru, en } objects");
    }

    sentences = data
      .filter((item) => item && typeof item.ru === "string" && item.ru.trim().length > 0)
      .map((item) => ({ ru: item.ru.trim(), en: (item.en || "").trim() }));

    if (sentences.length === 0) {
      setStatus("No sentences found in data/sentences.json", true);
      return;
    }

    const savedIndex = parseInt(localStorage.getItem(STORAGE_KEY_INDEX) || "0", 10);
    currentIndex = Number.isFinite(savedIndex) ? Math.min(savedIndex, sentences.length - 1) : 0;

    updateProgressUI();
    updateRevealUI();
    updateVoiceLabel();
  } catch (err) {
    console.error(err);
    setStatus("Could not load sentences.json — check the file exists and you're serving over http(s).", true);
  }
}

function playBlob(blob) {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.addEventListener("ended", () => URL.revokeObjectURL(url));
  audio.addEventListener("error", () => URL.revokeObjectURL(url));
  return audio.play();
}

async function fetchAndPlay(slow = false) {
  const idx = currentIndex;
  const current = sentences[idx];
  if (!current) return;

  const entry = getOrCreateCacheEntry(idx);
  updateVoiceLabel();

  const cacheKey = slow ? "slow" : "normal";
  const cachedBlob = entry.blobs[cacheKey];

  if (cachedBlob) {
    // Already generated for this card -- just replay it, no network call.
    try {
      setStatus("");
      await playBlob(cachedBlob);
    } catch (err) {
      console.error(err);
      setStatus("Couldn't play the cached audio.", true);
    }
    return;
  }

  els.listenBtn.classList.add("loading");
  els.listenBtn.disabled = true;
  setStatus("Generating audio…");

  try {
    const params = new URLSearchParams({
      text: current.ru,
      voice: entry.voice,
      slow: slow ? "1" : "0",
    });
    const url = `${BACKEND_URL}/api/speak?${params.toString()}`;

    const res = await fetch(url);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Backend error ${res.status}: ${detail}`);
    }

    const blob = await res.blob();
    entry.blobs[cacheKey] = blob; // cache for next time -- no re-generation needed

    setStatus("");
    await playBlob(blob);
  } catch (err) {
    console.error(err);
    setStatus(
      "Couldn't reach the backend. Is it running/deployed, and is BACKEND_URL correct in js/config.js?",
      true
    );
  } finally {
    els.listenBtn.classList.remove("loading");
    els.listenBtn.disabled = false;
  }
}

// ---------- Event wiring ----------

els.listenBtn.addEventListener("click", () => fetchAndPlay(false));
els.slowerBtn.addEventListener("click", () => fetchAndPlay(true));

els.revealBtn.addEventListener("click", () => {
  revealed = !revealed;
  els.revealBtn.textContent = revealed ? "🙈 Hide text" : "👁️ Show text";
  updateRevealUI();
});

els.nextBtn.addEventListener("click", () => goToIndex(currentIndex + 1));
els.prevBtn.addEventListener("click", () => goToIndex(currentIndex - 1));

// ---------- Init ----------

loadSentences();
