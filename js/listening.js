// listening.js
//
// Loads the sentence list from data/sentences.json -- an array of
// { "ru": "...", "en": "..." } pairs -- and drives the listening
// exercise. Every tap of "Listen" makes a fresh request to the backend,
// which generates the MP3 live and streams it back. Nothing is cached
// or written anywhere -- the audio blob is used once and then discarded
// (its object URL is revoked right after).

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
  btnDmitry: document.getElementById("btn-dmitry"),
  btnSvetlana: document.getElementById("btn-svetlana"),
  statusLine: document.getElementById("status-line"),
};

const STORAGE_KEY_INDEX = "ru_listening_index";
const STORAGE_KEY_VOICE = "ru_listening_voice";

let sentences = [];
let currentIndex = 0;
let currentVoice = localStorage.getItem(STORAGE_KEY_VOICE) || "svetlana";
let revealed = false;
let currentObjectUrl = null;

function setStatus(message, isError = false) {
  els.statusLine.textContent = message || "";
  els.statusLine.classList.toggle("error", isError);
}

function updateVoiceUI() {
  els.btnDmitry.classList.toggle("active", currentVoice === "dmitry");
  els.btnSvetlana.classList.toggle("active", currentVoice === "svetlana");
  els.voiceLabel.textContent = currentVoice === "dmitry" ? "Dmitry" : "Svetlana";
  localStorage.setItem(STORAGE_KEY_VOICE, currentVoice);
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
  } catch (err) {
    console.error(err);
    setStatus("Could not load sentences.txt — check the file exists and you're serving over http(s).", true);
  }
}

async function fetchAndPlay(slow = false) {
  const current = sentences[currentIndex];
  if (!current) return;
  const text = current.ru;

  els.listenBtn.classList.add("loading");
  els.listenBtn.disabled = true;
  setStatus("Generating audio…");

  try {
    const params = new URLSearchParams({
      text,
      voice: currentVoice,
      slow: slow ? "1" : "0",
    });
    const url = `${BACKEND_URL}/api/speak?${params.toString()}`;

    const res = await fetch(url);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Backend error ${res.status}: ${detail}`);
    }

    const blob = await res.blob();

    // Clean up any previous object URL before creating a new one.
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }

    currentObjectUrl = URL.createObjectURL(blob);
    const audio = new Audio(currentObjectUrl);

    audio.addEventListener("ended", () => {
      if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = null;
      }
    });

    setStatus("");
    await audio.play();
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

els.btnDmitry.addEventListener("click", () => {
  currentVoice = "dmitry";
  updateVoiceUI();
});
els.btnSvetlana.addEventListener("click", () => {
  currentVoice = "svetlana";
  updateVoiceUI();
});

// ---------- Init ----------

updateVoiceUI();
loadSentences();
