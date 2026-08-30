// listening.js
//
// Drives the listening exercise: loads data/sentences.json, and lets
// the person swipe right ("I know it") or left ("Again") on each card,
// picked via progress.js's simple 70/20/10 weighted odds (see
// progress.js for the model -- no more streaks or daily target).
// Audio for a card is generated once (random voice) and cached in
// memory for the rest of the session -- replaying the same card is
// instant.

const els = {
  overallFill: document.getElementById("overall-fill"),
  overallLabel: document.getElementById("overall-label"),

  deck: document.getElementById("deck"),
  swipeCard: document.getElementById("swipe-card"),
  overlayKnow: document.getElementById("overlay-know"),
  overlayAgain: document.getElementById("overlay-again"),

  listenBtn: document.getElementById("listen-btn"),
  listenHint: document.getElementById("listen-hint"),
  slowerBtn: document.getElementById("slower-btn"),
  revealBox: document.getElementById("reveal-box"),

  statusLine: document.getElementById("status-line"),
};

const VOICES = ["dmitry", "svetlana"];

let sentences = [];
let currentIndex = null;
let revealed = false;

// In-memory audio cache, cleared on page reload.
// cardAudioCache[index] = { voice: "dmitry"|"svetlana", blobs: { normal: Blob, slow: Blob } }
const cardAudioCache = {};

// ---------- Small helpers ----------

function pickRandomVoice() {
  return VOICES[Math.floor(Math.random() * VOICES.length)];
}

function getOrCreateAudioEntry(index) {
  if (!cardAudioCache[index]) {
    cardAudioCache[index] = { voice: pickRandomVoice(), blobs: {} };
  }
  return cardAudioCache[index];
}

function setStatus(message, isError) {
  els.statusLine.textContent = message || "";
  els.statusLine.classList.toggle("error", !!isError);
}

// ---------- Rendering: stats ----------

function renderOverall() {
  const stats = RuProgress.getOverallStats();
  els.overallFill.style.width = `${Math.min(100, stats.pct)}%`;
  els.overallLabel.textContent = `${stats.success.toLocaleString()} / ${stats.total.toLocaleString()} done (${stats.pct}%)`;
}

// ---------- Rendering: card ----------

function renderRevealUI() {
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
    els.revealBox.textContent = "Tap to reveal";
    els.revealBox.classList.add("hidden-text");
  }
}

function resetCardTransform() {
  els.swipeCard.style.transition = "none";
  els.swipeCard.style.transform = "translate(0px, 0px) rotate(0deg)";
  els.overlayKnow.style.opacity = 0;
  els.overlayAgain.style.opacity = 0;
  // Force reflow so the next transition (if any) applies cleanly.
  void els.swipeCard.offsetWidth;
  els.swipeCard.style.transition = "";
}

// Picks a brand new card via the weighted pools and shows it. This is
// an endless feed now -- there's no daily target to run out of, so
// this always succeeds as long as at least one sentence exists.
function showNextCard() {
  currentIndex = RuProgress.pickNextIndex(sentences.length);

  if (currentIndex === null) {
    setStatus("No sentences available.", true);
    return;
  }

  els.deck.style.display = "";

  revealed = false;
  renderRevealUI();
  resetCardTransform();
  setStatus("");
  renderOverall();
}

// ---------- Data loading ----------

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

    RuProgress.setTotalSentences(sentences.length);
    showNextCard();
  } catch (err) {
    console.error(err);
    setStatus("Could not load sentences.json — check the file exists and you're serving over http(s).", true);
  }
}

// ---------- Audio ----------

function playBlob(blob) {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.addEventListener("ended", () => URL.revokeObjectURL(url));
  audio.addEventListener("error", () => URL.revokeObjectURL(url));
  return audio.play();
}

async function fetchAndPlay(slow) {
  const idx = currentIndex;
  const current = sentences[idx];
  if (!current) return;

  const entry = getOrCreateAudioEntry(idx);
  const cacheKey = slow ? "slow" : "normal";
  const cachedBlob = entry.blobs[cacheKey];

  if (cachedBlob) {
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
    entry.blobs[cacheKey] = blob;

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

// ---------- Swipe / judge logic ----------

function commitSwipe(knewIt) {
  if (currentIndex === null) return;
  const idx = currentIndex;

  const flyX = knewIt ? window.innerWidth : -window.innerWidth;
  const rotate = knewIt ? 25 : -25;

  els.swipeCard.style.transition = "transform 0.35s ease, opacity 0.35s ease";
  els.swipeCard.style.transform = `translate(${flyX}px, -40px) rotate(${rotate}deg)`;
  els.swipeCard.style.opacity = "0";

  // Marks this sentence "success" or "failed". If it was previously
  // "success" and you just got it wrong, it drops back to "failed" here
  // -- and since the progress bar is a live count of "success" cards,
  // that alone is what makes the bar go back down by one.
  RuProgress.recordAnswer(idx, knewIt);

  const onDone = () => {
    els.swipeCard.removeEventListener("transitionend", onDone);
    els.swipeCard.style.opacity = "1";
    showNextCard();
  };
  els.swipeCard.addEventListener("transitionend", onDone);

  // Fallback in case transitionend doesn't fire (e.g. reduced-motion settings).
  setTimeout(() => {
    if (els.swipeCard.style.opacity === "0") onDone();
  }, 450);
}

let dragState = null;

function onPointerDown(e) {
  // Don't start a drag from interactive controls inside the card
  // (buttons, or the tap-to-reveal box).
  if (e.target.closest("button") || e.target.closest("#reveal-box")) return;
  dragState = {
    startX: e.clientX,
    startY: e.clientY,
    dx: 0,
    dy: 0,
    pointerId: e.pointerId,
  };
  els.swipeCard.setPointerCapture(e.pointerId);
  els.swipeCard.style.transition = "none";
}

function onPointerMove(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  dragState.dx = e.clientX - dragState.startX;
  dragState.dy = e.clientY - dragState.startY;

  const rotate = dragState.dx / 12;
  els.swipeCard.style.transform = `translate(${dragState.dx}px, ${dragState.dy}px) rotate(${rotate}deg)`;

  const frac = Math.min(1, Math.abs(dragState.dx) / 140);
  if (dragState.dx > 0) {
    els.overlayKnow.style.opacity = frac;
    els.overlayAgain.style.opacity = 0;
  } else if (dragState.dx < 0) {
    els.overlayAgain.style.opacity = frac;
    els.overlayKnow.style.opacity = 0;
  } else {
    els.overlayKnow.style.opacity = 0;
    els.overlayAgain.style.opacity = 0;
  }
}

function onPointerUp(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const dx = dragState.dx;
  dragState = null;

  const THRESHOLD = 100;
  if (dx > THRESHOLD) {
    commitSwipe(true);
  } else if (dx < -THRESHOLD) {
    commitSwipe(false);
  } else {
    els.swipeCard.style.transition = "transform 0.25s ease";
    els.swipeCard.style.transform = "translate(0px, 0px) rotate(0deg)";
    els.overlayKnow.style.opacity = 0;
    els.overlayAgain.style.opacity = 0;
  }
}

// ---------- Event wiring ----------

els.listenBtn.addEventListener("click", () => fetchAndPlay(false));
els.slowerBtn.addEventListener("click", () => fetchAndPlay(true));

els.revealBox.addEventListener("click", () => {
  revealed = !revealed;
  renderRevealUI();
});

els.swipeCard.addEventListener("pointerdown", onPointerDown);
els.swipeCard.addEventListener("pointermove", onPointerMove);
els.swipeCard.addEventListener("pointerup", onPointerUp);
els.swipeCard.addEventListener("pointercancel", onPointerUp);

// ---------- Init ----------

loadSentences();
