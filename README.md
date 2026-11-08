# Virtual AR Glasses Maintenance Assistant

A minimal prototype of virtual AR glasses built with **Three.js + TypeScript + Vite** on the frontend and **FastAPI + WebSockets + Google GenAI SDK** on the backend.

The user walks around a 3D industrial pump in first-person view. Every 1 second, the camera view is captured, downscaled to 512px JPEG, and streamed over WebSocket to the backend. The technician can ask questions in the AR HUD, and Gemini Flash (or mock mode) answers by analyzing the recent frames, streaming tokens in real time directly onto the glasses display.

---

## Quick Start (Two Commands)

### 1. Terminal 1 (Backend)
```bash
python -m uvicorn main:app --port 8000 --app-dir backend --reload
```
*(Alternative: `python backend/main.py`)*

### 2. Terminal 2 (Frontend)
```bash
npm --prefix frontend run dev
```

Open your browser to: **[http://localhost:5173](http://localhost:5173)**

---

## Configuration & Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(empty)* | Your Google Gemini API key. If empty or missing, backend automatically falls back to `MOCK_MODE`. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model name for vision streaming. |
| `MOCK_MODE` | `true` | Set to `true` to run without an API key (returns simulated streamed tokens and fault analysis). Set to `false` for live Gemini. |

---

## Features & Controls

- **3D Industrial Pump**: Built using geometric primitives:
  - Heavy metal skid baseplate with corner mounting bolts
  - Electric motor cylinder with cooling ribs, fan cowl, and electrical junction box
  - Central shaft coupling guard
  - Impeller volute housing with inlet/outlet piping and flanges
  - Manual valve with safety-red handwheel
  - Analog pressure dial gauge (0–10 BAR) with normal and danger zones
- **AR First-Person Look & Locomotion**:
  - Click viewport to lock pointer
  - **WASD / Arrow Keys**: Walk around pump
  - **Mouse**: Pitch & yaw look
  - **ESC**: Release mouse cursor to interact with HUD
- **Real-Time AR HUD**:
  - Translucent cyber-dark HUD overlay with center reticle & coordinate telemetry
  - Live 1 FPS thumbnail monitor in the top right showing the exact downscaled 512px JPEG sent to Gemini
  - Streaming answer area with typewriter token arrival
  - **Performance Telemetry**: Displays Time-to-First-Token (TTFT) and Total Turnaround Latency
  - Quick action suggestion chips (`"What do you see?"`, `"Is anything wrong?"`, etc.)
- **Fault Simulation (Stretch Goal)**:
  - Toggle switch in top-left HUD: `SIMULATE PUMP FAULT`
  - When enabled: pressure gauge needle pegs into the red overpressure zone (>8.5 BAR), gauge face displays warning, warning beacon illuminates, and blue fluid visibly leaks from the valve junction.
  - Test asking *"Is anything wrong?"* with and without the fault toggle active!

---

## Architecture & Protocol

See [docs/protocol.md](docs/protocol.md) for full protocol specifications.

- **Client -> Server**:
  - `{type: "frame", t: <timestamp_ms>, image_b64: "<jpeg_base64>"}` (1 Hz)
  - `{type: "question", text: "<prompt>"}`
- **Server -> Client**:
  - `{type: "token", text: "<chunk>"}` (streamed)
  - `{type: "done", ttft_ms: <int>, latency_ms: <int>}`
  - `{type: "error", message: "<description>"}`

The backend retains a rolling FIFO buffer of the last 5 frames per connection and has zero Three.js dependencies, making it directly compatible with Unity, Unreal, or OpenXR AR devices.

---

## Design Choices & Assumptions

1. **Downscaling**: Canvas frames are captured offscreen and downscaled to 512×512 JPEG at ~80% quality. This keeps bandwidth under ~30KB/frame (~240 kbps), minimizing latency while preserving sharp detail for visual gauge readings.
2. **WebGL Drawing Buffer**: Configured `preserveDrawingBuffer: true` in Three.js renderer to ensure frame extraction never samples an empty or cleared buffer.
3. **MOCK_MODE Fallback**: If `GEMINI_API_KEY` is not supplied or invalid, the backend automatically falls back to `MOCK_MODE` so the application runs immediately without breaking.
