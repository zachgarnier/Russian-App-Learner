"""
server.py

Minimal backend for the Russian Listening app.

Exposes ONE endpoint:

    GET /api/speak?text=<sentence>&voice=<dmitry|svetlana>&slow=<0|1>

It generates the audio live with edge-tts (Microsoft's free neural TTS)
and streams the MP3 bytes straight back in the HTTP response.
Nothing is ever written to disk and nothing is cached in a database --
each request regenerates the audio from scratch, in memory, and the
bytes are discarded the moment the response finishes sending.

Deploy this for free on Render.com (or Railway / Fly.io / a VPS you own).
See ../DEPLOY.md for step-by-step instructions.

Run locally for testing:
    pip install -r requirements.txt
    python3 server.py
    # then open http://localhost:5000/api/speak?text=Привет&voice=dmitry
"""

import asyncio
import io
import os

import edge_tts
from flask import Flask, request, send_file, abort, jsonify
from flask_cors import CORS

app = Flask(__name__)

# Allow requests from any origin by default so this works from your
# GitHub Pages site regardless of the exact URL. If you want to lock
# it down, replace "*" with your Pages URL, e.g.:
#   CORS(app, origins=["https://yourusername.github.io"])
CORS(app, origins="*")

VOICE_MAP = {
    "dmitry": "ru-RU-DmitryNeural",
    "svetlana": "ru-RU-SvetlanaNeural",
}

MAX_TEXT_LENGTH = 500  # simple abuse guard


async def synthesize(text: str, voice_id: str, rate: str) -> bytes:
    """Generate MP3 audio for `text` and return the raw bytes (in memory only)."""
    communicate = edge_tts.Communicate(text, voice=voice_id, rate=rate)
    buffer = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buffer.write(chunk["data"])
    buffer.seek(0)
    return buffer.read()


@app.route("/api/speak", methods=["GET"])
def speak():
    text = request.args.get("text", "").strip()
    voice_key = request.args.get("voice", "svetlana").lower()
    slow = request.args.get("slow", "0") == "1"

    if not text:
        abort(400, description="Missing 'text' query parameter.")
    if len(text) > MAX_TEXT_LENGTH:
        abort(400, description=f"Text too long (max {MAX_TEXT_LENGTH} characters).")
    if voice_key not in VOICE_MAP:
        abort(400, description=f"Unknown voice '{voice_key}'. Use one of: {list(VOICE_MAP)}")

    voice_id = VOICE_MAP[voice_key]
    rate = "-30%" if slow else "+0%"

    try:
        audio_bytes = asyncio.run(synthesize(text, voice_id, rate))
    except Exception as e:
        abort(502, description=f"TTS generation failed: {e}")

    if not audio_bytes:
        abort(502, description="TTS generation returned no audio.")

    return send_file(
        io.BytesIO(audio_bytes),
        mimetype="audio/mpeg",
        as_attachment=False,
        download_name="speech.mp3",
    )


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
