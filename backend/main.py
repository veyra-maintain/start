import os
import json
import time
import base64
import asyncio
from datetime import datetime
from collections import deque
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

# Load .env from current directory or parent directory
env_path = Path(__file__).resolve().parent / ".env"
if not env_path.exists():
    env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
MOCK_MODE_ENV = os.getenv("MOCK_MODE", "false").strip().lower()
MOCK_MODE = MOCK_MODE_ENV in ("true", "1", "yes") or not GEMINI_API_KEY

SYSTEM_PROMPT = (
    "You are an AR maintenance assistant seeing through the technician's glasses. "
    "Answer briefly and only about what you can see."
)

app = FastAPI(title="Virtual AR Glasses Maintenance Assistant")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Optional client initialization if not mock mode
genai_client = None
if not MOCK_MODE:
    try:
        from google import genai
        genai_client = genai.Client(api_key=GEMINI_API_KEY)
        print(f"[Backend] Gemini Client initialized with model: {GEMINI_MODEL}")
    except Exception as exc:
        print(f"[Backend] Error initializing Gemini client: {exc}. Falling back to MOCK_MODE.")
        MOCK_MODE = True
else:
    print(f"[Backend] Running in MOCK_MODE (no API key required).")


@app.get("/")
@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "mock_mode": MOCK_MODE,
        "model": GEMINI_MODEL if not MOCK_MODE else "mock-gemini-flash",
    }


def generate_mock_stream_response(question: str, frame_count: int):
    """
    Generate contextual mock response when running without an API key.
    """
    q_lower = question.lower()
    
    if "wrong" in q_lower or "fault" in q_lower or "problem" in q_lower or "leak" in q_lower:
        text = (
            "Visual inspection alert: The analog pressure gauge indicates a high-pressure condition "
            "with the needle entering the red zone (~8.5 bar). Additionally, there appears to be blue fluid "
            "leaking from the secondary valve junction. Recommend isolating the inlet line and checking the seal."
        )
    elif "gauge" in q_lower or "pressure" in q_lower:
        text = (
            "The circular analog pressure gauge is mounted on top of the pump discharge manifold. "
            "Please check needle alignment against operating thresholds."
        )
    elif "valve" in q_lower or "wheel" in q_lower:
        text = (
            "The manual control valve with the red handwheel is positioned on the overhead discharge pipe. "
            "Ensure the stem is properly lubricated."
        )
    elif "motor" in q_lower or "pump" in q_lower or "what do you see" in q_lower or "what is this" in q_lower:
        text = (
            f"I see an industrial centrifugal pump assembly mounted on a heavy metal skid. "
            f"The electric motor cylinder drives the impeller volute through a central shaft coupling, "
            f"connected to inlet and discharge piping with an analog pressure gauge. "
            f"Based on {frame_count} live frames, the equipment is within camera view."
        )
    else:
        text = (
            f"Looking at the current camera feed ({frame_count} frames analyzed): "
            f"The industrial pump unit is clearly visible. To assist you best, ask about the motor, "
            f"valve assembly, pressure readings, or visual fault detection."
        )
    return text


@app.websocket("/ws/session")
async def websocket_session(websocket: WebSocket):
    await websocket.accept()
    # Rolling buffer of last 5 frames
    frame_buffer = deque(maxlen=5)
    print(f"[WS] Client connected. Buffer capacity: 5 frames.")

    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                msg = json.loads(raw_data)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"type": "error", "message": "Invalid JSON format"}))
                continue

            msg_type = msg.get("type")

            if msg_type == "frame":
                t = msg.get("t", int(time.time() * 1000))
                image_b64 = msg.get("image_b64", "")
                
                # Strip data url prefix if present
                if "," in image_b64:
                    image_b64 = image_b64.split(",", 1)[1]

                try:
                    raw_bytes = base64.b64decode(image_b64)
                    dt_str = datetime.fromtimestamp(t / 1000.0).strftime("%H:%M:%S.%f")[:-3]
                    frame_buffer.append({
                        "t": t,
                        "time_str": dt_str,
                        "data": raw_bytes,
                    })
                except Exception as e:
                    print(f"[WS] Error decoding frame: {e}")

            elif msg_type == "question":
                question_text = msg.get("text", "").strip()
                if not question_text:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "Question text cannot be empty."
                    }))
                    continue

                t_start = time.perf_counter()
                ttft_ms = None
                buffered_list = list(frame_buffer)
                frame_count = len(buffered_list)

                # Case 1: MOCK_MODE or no Gemini client
                if MOCK_MODE or genai_client is None:
                    mock_answer = generate_mock_stream_response(question_text, frame_count)
                    # Simulate realistic first token latency (150-250ms)
                    await asyncio.sleep(0.18)
                    ttft_ms = int((time.perf_counter() - t_start) * 1000)

                    # Split text into small word tokens
                    words = mock_answer.split(" ")
                    for i, word in enumerate(words):
                        chunk = word + (" " if i < len(words) - 1 else "")
                        await websocket.send_text(json.dumps({
                            "type": "token",
                            "text": chunk
                        }))
                        await asyncio.sleep(0.035)

                    total_latency_ms = int((time.perf_counter() - t_start) * 1000)
                    await websocket.send_text(json.dumps({
                        "type": "done",
                        "ttft_ms": ttft_ms,
                        "latency_ms": total_latency_ms
                    }))

                # Case 2: Live Gemini streaming
                else:
                    try:
                        from google.genai import types

                        contents = []
                        if buffered_list:
                            for idx, f in enumerate(buffered_list):
                                contents.append(
                                    f"[Frame {idx + 1}/{frame_count} captured at {f['time_str']} (T={f['t']})]"
                                )
                                contents.append(
                                    types.Part.from_bytes(
                                        data=f["data"],
                                        mime_type="image/jpeg"
                                    )
                                )
                        else:
                            contents.append("[Note: No video frames received yet from headset feed]")

                        contents.append(f"User question: {question_text}")

                        config = types.GenerateContentConfig(
                            system_instruction=SYSTEM_PROMPT,
                            temperature=0.2,
                        )

                        stream = await genai_client.aio.models.generate_content_stream(
                            model=GEMINI_MODEL,
                            contents=contents,
                            config=config,
                        )

                        async for chunk in stream:
                            chunk_text = chunk.text
                            if chunk_text:
                                if ttft_ms is None:
                                    ttft_ms = int((time.perf_counter() - t_start) * 1000)
                                await websocket.send_text(json.dumps({
                                    "type": "token",
                                    "text": chunk_text
                                }))

                        total_latency_ms = int((time.perf_counter() - t_start) * 1000)
                        if ttft_ms is None:
                            ttft_ms = total_latency_ms

                        await websocket.send_text(json.dumps({
                            "type": "done",
                            "ttft_ms": ttft_ms,
                            "latency_ms": total_latency_ms
                        }))

                    except Exception as exc:
                        print(f"[WS] Gemini streaming exception: {exc}")
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": f"Gemini error: {str(exc)}"
                        }))

            else:
                # Unknown message type
                pass

    except WebSocketDisconnect:
        print("[WS] Client disconnected cleanly.")
    except Exception as e:
        print(f"[WS] Unexpected session error: {e}")


if __name__ == "__main__":
    import uvicorn
    app_dir = str(Path(__file__).resolve().parent)
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, app_dir=app_dir)
